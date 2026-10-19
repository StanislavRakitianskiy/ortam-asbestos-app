import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { errorResponse } from "@/server/http";
import type { LabDocumentDto, LabResultDto } from "@/server/services/labDocumentDto";
import { labDocumentService, type UploadFile } from "@/server/services/labDocumentService";
import { labReviewService } from "@/server/services/labReviewService";
import { configuredKey, fakeMessage, loadAiFixture, scriptedSender } from "../helpers/fakeAi";
import { createTestDb, type TestDb } from "../helpers/testDb";

let testDb: TestDb;
let storageDir: string;
let labA: Uint8Array;

beforeAll(async () => {
  testDb = createTestDb();
  storageDir = mkdtempSync(path.join(tmpdir(), "ortam-storage-"));
  labA = new Uint8Array(await readFile("fixtures/LAB-A_fictional_lab_report.pdf"));
});

afterAll(async () => {
  await testDb.cleanup();
  rmSync(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await testDb.db.project.deleteMany();
});

type Output = ReturnType<typeof loadAiFixture>["output"];
const fixture = (name: string): Output => structuredClone(loadAiFixture(name).output);

/** The recorded LAB-A answer with the S01 sample ID misread as "S1", as a model might. */
function misreadS01(): Output {
  const output = fixture("lab-a.recorded");
  output.results[0].sampleId = "S1";
  return output;
}

/**
 * A project with LAB-A uploaded and extracted from the given AI answers (first upload, then each re-extraction).
 * Background work runs when the test calls drain().
 */
async function extractedLabA(...outputs: Output[]) {
  // Project codes are unique; a second project in one test gets its own.
  const existing = await testDb.db.project.count();
  const code = existing === 0 ? "ORTAM-DEMO-001" : `OTHER-${existing}`;
  const project = await testDb.db.project.create({ data: { code, client: "Client", building: "Building" } });
  const answers = (outputs.length > 0 ? outputs : [fixture("lab-a.recorded")]).map((output) => fakeMessage(JSON.stringify(output)));
  const queue: (() => Promise<void>)[] = [];
  const documents = labDocumentService({
    db: testDb.db,
    storageDir,
    extraction: () => ({ model: "claude-test-model", keyStatus: configuredKey, send: scriptedSender(...answers) }),
    schedule: (task) => queue.push(task),
  });
  const file: UploadFile = { name: "LAB-A.pdf", type: "application/pdf", size: labA.byteLength, read: async () => labA };
  const [outcome] = await documents.upload(project.id, [file]);
  if (outcome.outcome !== "created") throw new Error("upload failed");
  const drain = async () => {
    while (queue.length > 0) await queue.shift()!();
  };
  await drain();
  return { projectId: project.id, documentId: outcome.document.id, documents, review: labReviewService(testDb.db), drain };
}

function rowOf(document: LabDocumentDto, sampleId: string, layer?: string): LabResultDto {
  const row = document.results.find((item) => item.sampleId === sampleId && (layer === undefined || item.layer === layer));
  if (!row) throw new Error(`no row ${sampleId} ${layer ?? ""}`);
  return row;
}

const codes = (row: LabResultDto) => row.flags.map((flag) => flag.code);

describe("correcting an extracted row", () => {
  it("keeps the AI value in aiJson, updates the current value and logs the correction", async () => {
    const { projectId, documentId, documents, review } = await extractedLabA(misreadS01());
    const before = rowOf(await documents.get(projectId, documentId), "S1");
    expect(codes(before)).toContain("SAMPLE_ID_NOT_IN_LINE");
    expect(before.confidence).toBe("LOW");
    const aiJsonBefore = (await testDb.db.labResult.findUniqueOrThrow({ where: { id: before.id } })).aiJson;

    const document = await review.correct(projectId, documentId, before.id, {
      changes: { sampleId: "S01" },
      reason: "The label and the lab line read S01",
    });

    const stored = await testDb.db.labResult.findUniqueOrThrow({ where: { id: before.id } });
    expect(stored.sampleId).toBe("S01");
    expect(stored.aiJson).toBe(aiJsonBefore);
    expect(JSON.parse(stored.aiJson ?? "{}").sampleId).toBe("S1");

    expect(await testDb.db.correction.findMany({ where: { entityId: before.id } })).toMatchObject([
      { projectId, entity: "LabResult", field: "sampleId", oldValue: '"S1"', newValue: '"S01"', reason: "The label and the lab line read S01" },
    ]);

    const corrected = rowOf(document, "S01");
    expect(corrected.aiValues?.sampleId).toBe("S1");
    expect(corrected.corrections).toMatchObject([{ field: "sampleId", oldValue: "S1", newValue: "S01" }]);
    // The evidence check runs again on the corrected value; the AI's confidence is not raised.
    expect(codes(corrected)).not.toContain("SAMPLE_ID_NOT_IN_LINE");
    expect(corrected.confidence).toBe("LOW");
    expect(corrected.reviewStatus).toBe("PENDING");
  });

  it("logs one entry per changed field and flags a correction that contradicts the cited line", async () => {
    const { projectId, documentId, documents, review } = await extractedLabA();
    const s01 = rowOf(await documents.get(projectId, documentId), "S01");

    const document = await review.correct(projectId, documentId, s01.id, {
      changes: { layer: "Insulation", resultLabel: "NOT_DETECTED", percentage: 15, asbestosType: "" },
      reason: "Testing a wrong correction",
    });

    const log = await testDb.db.correction.findMany({ where: { entityId: s01.id }, orderBy: { field: "asc" } });
    expect(log.map((entry) => [entry.field, entry.oldValue, entry.newValue])).toEqual([
      ["asbestosType", '"Chrysotile"', null],
      ["resultLabel", '"DETECTED"', '"NOT_DETECTED"'],
    ]);
    expect(codes(rowOf(document, "S01"))).toContain("LABEL_CONTRADICTS_LINE");
  });

  it("refuses a correction without a reason with HTTP 400 and changes nothing", async () => {
    const { projectId, documentId, documents, review } = await extractedLabA(misreadS01());
    const row = rowOf(await documents.get(projectId, documentId), "S1");

    for (const reason of [undefined, "", "   "]) {
      const error = await review.correct(projectId, documentId, row.id, { changes: { sampleId: "S01" }, reason }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors).toEqual({ reason: ["Enter a short reason."] });
      expect(errorResponse(error).status).toBe(400);
    }
    expect((await testDb.db.labResult.findUniqueOrThrow({ where: { id: row.id } })).sampleId).toBe("S1");
    expect(await testDb.db.correction.count()).toBe(0);
  });

  it("refuses a correction that changes nothing", async () => {
    const { projectId, documentId, documents, review } = await extractedLabA();
    const row = rowOf(await documents.get(projectId, documentId), "S01");
    await expect(review.correct(projectId, documentId, row.id, { changes: { sampleId: "S01" }, reason: "same" })).rejects.toThrow(
      "Nothing changed",
    );
  });

  it("puts a corrected accepted row back to pending unless it is accepted in the same step", async () => {
    const { projectId, documentId, documents, review } = await extractedLabA();
    const row = rowOf(await documents.get(projectId, documentId), "S03");
    await review.decide(projectId, documentId, row.id, { decision: "ACCEPT" });

    let document = await review.correct(projectId, documentId, row.id, { changes: { labNote: "Checked" }, reason: "note" });
    expect(rowOf(document, "S03").reviewStatus).toBe("PENDING");
    document = await review.correct(projectId, documentId, row.id, { changes: { labNote: null }, reason: "undo", accept: true });
    expect(rowOf(document, "S03").reviewStatus).toBe("ACCEPTED");
  });
});

describe("accepting and rejecting rows", () => {
  it("accepts the document once every row is accepted or rejected, and reopens it with a row", async () => {
    const { projectId, documentId, documents, review } = await extractedLabA();
    const initial = await documents.get(projectId, documentId);
    const [s01, tile, adhesive, s03] = initial.results;
    for (const row of [s01, tile, adhesive]) await review.decide(projectId, documentId, row.id, { decision: "ACCEPT" });
    expect((await documents.get(projectId, documentId)).status).toBe("NEEDS_REVIEW");

    await expect(review.decide(projectId, documentId, s03.id, { decision: "REJECT" })).rejects.toBeInstanceOf(ValidationError);
    let document = await review.decide(projectId, documentId, s03.id, { decision: "REJECT", reason: "Duplicate of a later report" });
    expect(document.status).toBe("ACCEPTED");
    expect(rowOf(document, "S03")).toMatchObject({ reviewStatus: "REJECTED", rejectReason: "Duplicate of a later report" });

    document = await review.decide(projectId, documentId, s03.id, { decision: "REOPEN" });
    expect(document.status).toBe("NEEDS_REVIEW");
    expect(rowOf(document, "S03")).toMatchObject({ reviewStatus: "PENDING", rejectReason: null });
  });

  it("accepts all verified rows only: a row whose page does not exist stays pending", async () => {
    const { projectId, documentId, review } = await extractedLabA(fixture("lab-a.tampered-wrong-page"));
    const { accepted, document } = await review.acceptVerified(projectId, documentId);
    expect(accepted).toBe(3);
    expect(document.results.map((row) => `${row.sampleId} ${row.reviewStatus}`)).toEqual([
      "S01 ACCEPTED",
      "S02 ACCEPTED",
      "S02 ACCEPTED",
      "S03 PENDING",
    ]);
    expect(document.status).toBe("NEEDS_REVIEW");
    // Its source reference is unusable, so it cannot be accepted one by one either.
    await expect(review.decide(projectId, documentId, rowOf(document, "S03").id, { decision: "ACCEPT" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("moves Project.updatedAt on every correction, decision and added row", async () => {
    const { projectId, documentId, documents, review } = await extractedLabA();
    const row = rowOf(await documents.get(projectId, documentId), "S01");
    const longAgo = new Date("2020-01-01T00:00:00Z");
    const actions = [
      () => review.correct(projectId, documentId, row.id, { changes: { labNote: "seen" }, reason: "note" }),
      () => review.decide(projectId, documentId, row.id, { decision: "ACCEPT" }),
      () => review.acceptVerified(projectId, documentId),
      () =>
        review.addManual(projectId, documentId, {
          sampleId: "S99",
          layer: "Test",
          resultLabel: "INCONCLUSIVE",
          asbestosType: null,
          percentage: null,
          labNote: null,
          sourcePage: 1,
          sourceText: "S01  Insulation",
          reason: "test",
        }),
    ];
    for (const action of actions) {
      await testDb.db.project.update({ where: { id: projectId }, data: { updatedAt: longAgo } });
      await action();
      const { updatedAt } = await testDb.db.project.findUniqueOrThrow({ where: { id: projectId } });
      expect(updatedAt.getTime()).toBeGreaterThan(longAgo.getTime());
    }
  });

  it("answers 404 for a row of another document and 409 while the document is being extracted", async () => {
    const { projectId, documentId, documents, review } = await extractedLabA();
    const row = rowOf(await documents.get(projectId, documentId), "S01");
    const other = await extractedLabA();
    await expect(review.decide(other.projectId, other.documentId, row.id, { decision: "ACCEPT" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(review.decide(other.projectId, documentId, row.id, { decision: "ACCEPT" })).rejects.toBeInstanceOf(NotFoundError);

    await documents.startExtraction(projectId, documentId, { replaceReviewed: false });
    await expect(review.decide(projectId, documentId, row.id, { decision: "ACCEPT" })).rejects.toThrow("is being extracted");
  });
});

describe("adding a row the AI missed", () => {
  const tileRow = {
    sampleId: "S02",
    layer: "Floor tile",
    resultLabel: "NOT_DETECTED" as const,
    asbestosType: null,
    percentage: null,
    labNote: null,
    sourcePage: 1,
    sourceText: "S02  Floor tile  Not detected  Not reported  Not reported",
    reason: "The AI merged both S02 layers into one row",
  };

  it("stores a manual row with its evidence, checks the quote and covers the skipped line", async () => {
    const { projectId, documentId, documents, review } = await extractedLabA(fixture("lab-a.tampered-merged-s02"));
    const before = await documents.get(projectId, documentId);
    expect(before.warnings.map((warning) => warning.code)).toContain("LINE_NOT_EXTRACTED");

    const document = await review.addManual(projectId, documentId, tileRow);
    const added = rowOf(document, "S02", "Floor tile");
    expect(added).toMatchObject({
      origin: "MANUAL",
      confidence: null,
      evidenceVerified: true,
      reviewStatus: "PENDING",
      addedReason: "The AI merged both S02 layers into one row",
      aiValues: null,
      corrections: [],
    });
    expect((await testDb.db.labResult.findUniqueOrThrow({ where: { id: added.id } })).aiJson).toBeNull();
    expect(document.warnings.map((warning) => warning.code)).not.toContain("LINE_NOT_EXTRACTED");
    expect(await testDb.db.correction.findMany({ where: { entityId: added.id } })).toMatchObject([
      { field: "row", oldValue: null, reason: "The AI merged both S02 layers into one row" },
    ]);
  });

  it("requires a page that exists and a quote, and flags a quote that is not on the page", async () => {
    const { projectId, documentId, review } = await extractedLabA();
    await expect(review.addManual(projectId, documentId, { ...tileRow, sourcePage: undefined })).rejects.toBeInstanceOf(ValidationError);
    await expect(review.addManual(projectId, documentId, { ...tileRow, sourceText: "" })).rejects.toBeInstanceOf(ValidationError);
    const pageError = await review.addManual(projectId, documentId, { ...tileRow, sourcePage: 2 }).catch((error: unknown) => error);
    expect((pageError as ValidationError).fieldErrors).toEqual({ sourcePage: ["must be between 1 and 1"] });

    const document = await review.addManual(projectId, documentId, { ...tileRow, sampleId: "S09", sourceText: "S09  Plaster  Not detected" });
    const row = rowOf(document, "S09");
    expect(row.evidenceVerified).toBe(false);
    expect(codes(row)).toContain("EVIDENCE_NOT_FOUND");
  });
});

describe("what matching and the report receive", () => {
  it("only accepted rows of fully reviewed lab reports", async () => {
    const { projectId, documentId, documents, review } = await extractedLabA();
    const document = await documents.get(projectId, documentId);
    const tile = rowOf(document, "S02", "Floor tile");

    // Tile accepted, adhesive still pending: S02 must not look "not detected".
    await review.decide(projectId, documentId, tile.id, { decision: "ACCEPT" });
    expect(await review.acceptedResults(projectId)).toEqual([]);

    for (const row of [rowOf(document, "S01"), rowOf(document, "S02", "Black adhesive")]) {
      await review.decide(projectId, documentId, row.id, { decision: "ACCEPT" });
    }
    await review.decide(projectId, documentId, rowOf(document, "S03").id, { decision: "REJECT", reason: "test" });

    const accepted = await review.acceptedResults(projectId);
    expect(accepted.map((row) => `${row.sampleId} ${row.layer} ${row.resultLabel}`)).toEqual([
      "S01 Insulation DETECTED",
      "S02 Floor tile NOT_DETECTED",
      "S02 Black adhesive DETECTED",
    ]);
    expect(accepted[0]).toMatchObject({
      documentId,
      labReportId: "LAB-A",
      fileName: "LAB-A.pdf",
      page: 1,
      sourceText: "S01  Insulation  Detected  Chrysotile  15%",
    });
  });
});

describe("extracting again after review", () => {
  it("does not erase accepted, corrected or added rows and replaces only the untouched drafts", async () => {
    const { projectId, documentId, documents, review, drain } = await extractedLabA(misreadS01(), misreadS01());
    const document = await documents.get(projectId, documentId);
    const s1 = rowOf(document, "S1");
    const adhesive = rowOf(document, "S02", "Black adhesive");
    const tile = rowOf(document, "S02", "Floor tile");
    await review.decide(projectId, documentId, adhesive.id, { decision: "ACCEPT" });
    await review.correct(projectId, documentId, s1.id, { changes: { sampleId: "S01" }, reason: "label reads S01" });
    const manual = rowOf(
      await review.addManual(projectId, documentId, {
        sampleId: "S04",
        layer: "Note",
        resultLabel: "INCONCLUSIVE",
        asbestosType: null,
        percentage: null,
        labNote: null,
        sourcePage: 1,
        sourceText: "S03  Textured coating",
        reason: "test row",
      }),
      "S04",
    );

    await documents.startExtraction(projectId, documentId, { replaceReviewed: false });
    await drain();

    const after = await documents.get(projectId, documentId);
    expect(rowOf(after, "S02", "Black adhesive")).toMatchObject({ id: adhesive.id, reviewStatus: "ACCEPTED" });
    expect(rowOf(after, "S01")).toMatchObject({ id: s1.id, corrections: [{ field: "sampleId", oldValue: "S1", newValue: "S01" }] });
    expect(rowOf(after, "S04").id).toBe(manual.id);
    // The new draft re-reads S01 as "S1": it is a different sample ID, so it is added for review, not merged.
    expect(after.results.map((row) => row.sampleId).sort()).toEqual(["S01", "S02", "S02", "S03", "S04", "S1"]);
    expect(rowOf(after, "S02", "Floor tile").id).not.toBe(tile.id);
    expect(after.status).toBe("NEEDS_REVIEW");
    expect(await testDb.db.correction.count({ where: { field: "sampleId" } })).toBe(1);
  });
});

describe("entering the lab report ID", () => {
  /** The recorded LAB-A answer without the report ID, as when the model cannot read the header. */
  function withoutReportId(): Output {
    const output = fixture("lab-a.recorded");
    (output.report as { labReportId: string | null }).labReportId = null;
    return output;
  }

  it("logs the ID with its reason, uses it in matching and keeps it through a new extraction", async () => {
    const { projectId, documentId, documents, review, drain } = await extractedLabA(withoutReportId(), withoutReportId());
    const warningCodes = (document: LabDocumentDto) => document.warnings.map((warning) => warning.code);
    expect(warningCodes(await documents.get(projectId, documentId))).toContain("LAB_REPORT_ID_MISSING");

    // Until an ID is entered, matching identifies the report by its file name.
    await review.acceptVerified(projectId, documentId);
    expect((await review.acceptedResults(projectId)).map((row) => row.labReportId)).toEqual(Array(4).fill("LAB-A.pdf"));

    const missingReason = await review.setLabReportId(projectId, documentId, { labReportId: "LAB-A" }).catch((error: unknown) => error);
    expect(errorResponse(missingReason).status).toBe(400);

    const document = await review.setLabReportId(projectId, documentId, { labReportId: " LAB-A ", reason: "Printed in the report title" });
    expect(document).toMatchObject({ labReportId: "LAB-A", labReportIdEntered: { reason: "Printed in the report title" } });
    expect(warningCodes(document)).not.toContain("LAB_REPORT_ID_MISSING");
    expect(await testDb.db.correction.findMany({ where: { entityId: documentId } })).toMatchObject([
      { entity: "LabDocument", field: "labReportId", oldValue: null, newValue: '"LAB-A"', reason: "Printed in the report title" },
    ]);
    expect((await review.acceptedResults(projectId)).map((row) => row.labReportId)).toEqual(Array(4).fill("LAB-A"));
    await expect(review.setLabReportId(projectId, documentId, { labReportId: "LAB-A", reason: "again" })).rejects.toThrow("Nothing changed");

    await documents.startExtraction(projectId, documentId, { replaceReviewed: false });
    await drain();
    const after = await documents.get(projectId, documentId);
    expect(after.labReportId).toBe("LAB-A");
    expect(warningCodes(after)).not.toContain("LAB_REPORT_ID_MISSING");
  });
});
