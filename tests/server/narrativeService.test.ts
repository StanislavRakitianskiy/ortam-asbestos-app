import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { formatCad } from "@/domain/format";
import type { NarrativeDraft } from "@/domain/narrative";
import { AiStepError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { SendMessage } from "@/server/ai/structuredCall";
import { narrativeService } from "@/server/services/narrativeService";
import { projectService } from "@/server/services/projectService";
import { factsHash, reportService, type ReportDraftDto } from "@/server/services/reportService";
import { configuredKey, fakeMessage, scriptedSender } from "../helpers/fakeAi";
import { SUPPLIED_LAB_FILES, createReviewedProject } from "../helpers/reviewedProject";
import { createTestDb, type TestDb } from "../helpers/testDb";

/**
 * Integration: the supplied lab PDFs are uploaded, extracted with the recorded answers and accepted; the report draft is
 * then built from the database, drafted with a replayed narrative answer, edited, reset and drafted again.
 */

let testDb: TestDb;
let storageDir: string;
let projectId: string;

const answer = (name: string) =>
  JSON.stringify((JSON.parse(readFileSync(`tests/fixtures/ai/${name}.json`, "utf8")) as { output: NarrativeDraft }).output);
const RECORDED = answer("narrative.recorded");
const GOOD = answer("narrative.handwritten");
const TAMPERED = answer("narrative.tampered-asbestos-free");

beforeAll(async () => {
  testDb = createTestDb();
  storageDir = mkdtempSync(path.join(tmpdir(), "ortam-storage-"));
  ({ projectId } = await createReviewedProject(testDb.db, storageDir, "ORTAM-DEMO-001", SUPPLIED_LAB_FILES));
}, 60_000);

afterAll(async () => {
  await testDb.cleanup();
  rmSync(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await testDb.db.reportNarrative.deleteMany();
  await testDb.db.aiRun.deleteMany({ where: { kind: "NARRATIVE" } });
  await testDb.db.reviewChecklist.deleteMany();
});

function narrative(send: SendMessage, keyStatus = configuredKey) {
  return narrativeService({ db: testDb.db, ai: () => ({ model: "claude-test-model", keyStatus, send }) });
}
const reports = () => reportService({ db: testDb.db });

const zoneIdOf = (report: ReportDraftDto, materialId: string) => {
  const found = report.model.findings.find((finding) => finding.materialId === materialId);
  if (found === undefined) throw new Error(`no zone ${materialId}`);
  return found.zoneId;
};

describe("report draft from the database", () => {
  it("builds the report model of the reviewed demo project", async () => {
    const report = await reports().get(projectId);
    const { model } = report;

    expect(model.findings.map((finding) => [finding.materialId, finding.category, finding.cost.text])).toEqual([
      ["M01", "A", "CAD 3,840.00"],
      ["M02", "A", "CAD 7,200.00"],
      ["M03", "A", "CAD 12,600.00"],
      ["M04", "D", "No asbestos-specific cost (not detected in the sampled material)"],
      ["M05", "B", "Not priced (quantity unknown)"],
      ["M06", "C", "Not priced (unresolved)"],
      ["M07", "C", "Not priced (unresolved)"],
    ]);
    const s02 = model.findings[1].samples[0];
    expect(s02.layers.map((layer) => [layer.layer, layer.statusText])).toEqual([
      ["Floor tile", "Not detected"],
      ["Black adhesive", "Detected"],
    ]);
    expect(s02.layers[1].sources).toEqual([
      expect.objectContaining({ labReportId: "LAB-A", fileName: "LAB-A_fictional_lab_report.pdf", page: 1, quote: expect.stringMatching(/^S02\s+Black adhesive\s+Detected/) }),
    ]);
    expect(model.findings[2].samples.map((sample) => sample.sampleId)).toEqual(["S03", "S07"]);
    expect(formatCad(model.costScenario.summary.total)).toBe("32,808.00");
    expect(model.appendices.labSources.map((document) => [document.labReportId, document.rows.length])).toEqual([
      ["LAB-A", 4],
      ["LAB-B", 3],
      ["LAB-C", 1],
    ]);
    expect(report.warnings).toEqual([]);
    expect(report.draft).toEqual({ lastRun: null, running: false, draftedAt: null, outdated: false });
  });

  it("reports a missing project", async () => {
    await expect(reports().get("missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("narrativeService.draft", () => {
  it("stores every slot as an AI draft and records the run with the facts hash", async () => {
    const before = await testDb.db.project.findUniqueOrThrow({ where: { id: projectId } });
    const { report, keptEdited } = await narrative(scriptedSender(fakeMessage(GOOD))).draft(projectId);

    expect(keptEdited).toBe(0);
    const rows = await testDb.db.reportNarrative.findMany({ where: { projectId } });
    expect(rows).toHaveLength(1 + 7 * 5 + 1);
    expect(rows.every((row) => row.source === "AI_DRAFT" && row.aiText === row.text)).toBe(true);
    expect(report.model.executiveSummary.narrative.source).toBe("AI_DRAFT");
    expect(report.model.findings[3].narrative.interpretation.text).toContain("limited to the sampled material");
    expect(report.warnings).toEqual([]);

    const runs = await testDb.db.aiRun.findMany({ where: { projectId, kind: "NARRATIVE" } });
    expect(runs.map((run) => [run.status, run.promptVersion, run.labDocumentId, run.inputHash])).toEqual([
      ["SUCCEEDED", "narrative.v1", null, factsHash(report.model)],
    ]);
    expect(report.draft).toMatchObject({ running: false, outdated: false, lastRun: expect.objectContaining({ status: "SUCCEEDED" }) });
    const after = await testDb.db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("stores the recorded real answer from the uploaded PDFs without a guardrail warning", async () => {
    const { report } = await narrative(scriptedSender(fakeMessage(RECORDED))).draft(projectId);
    expect(report.warnings).toEqual([]);
    expect(report.draft.outdated).toBe(false);
    expect(report.model.findings.every((finding) => finding.narrative.interpretation.source === "AI_DRAFT")).toBe(true);
  });

  it("flags the changed answer that claims an asbestos-free building", async () => {
    const { report } = await narrative(scriptedSender(fakeMessage(TAMPERED))).draft(projectId);
    expect(report.warnings).toEqual([
      expect.objectContaining({ code: "FORBIDDEN_CLAIM", section: "executiveSummary", excerpt: "Apart from these zones, this is an asbestos-free building." }),
    ]);
  });

  it("keeps the employee's edits when drafting again and offers the new draft through reset", async () => {
    const service = narrative(scriptedSender(fakeMessage(GOOD), fakeMessage(TAMPERED)));
    const first = await service.draft(projectId);
    const m05 = zoneIdOf(first.report, "M05");
    await service.save(projectId, { section: "zoneUncertainty", itemKey: m05, text: "M05 on the E01 east elevation: the panel area was not measured." });

    const second = await service.draft(projectId);
    expect(second.keptEdited).toBe(1);
    const row = await testDb.db.reportNarrative.findUniqueOrThrow({ where: { projectId_section_itemKey: { projectId, section: "zoneUncertainty", itemKey: m05 } } });
    expect([row.source, row.text]).toEqual(["EDITED", "M05 on the E01 east elevation: the panel area was not measured."]);
    expect(row.aiText).toBe("The quantity of M05 was not measured, so it is not priced.");
    // The unedited executive summary took the new draft.
    expect(second.report.model.executiveSummary.narrative.text).toContain("asbestos-free building");

    const reset = await service.reset(projectId, { section: "zoneUncertainty", itemKey: m05 });
    expect(reset.model.findings[4].narrative.uncertainty).toMatchObject({ source: "AI_DRAFT", text: "The quantity of M05 was not measured, so it is not priced." });
  });

  it("stores nothing when the answer stays unusable and explains why", async () => {
    const service = narrative(scriptedSender(fakeMessage("not json"), fakeMessage("{ still not json")));
    const failure = await service.draft(projectId).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AiStepError);
    expect((failure as AiStepError).code).toBe("INVALID_RESPONSE");
    expect((failure as AiStepError).message).toContain("after one automatic retry");
    expect(await testDb.db.reportNarrative.count({ where: { projectId } })).toBe(0);
    const report = await reports().get(projectId);
    expect(report.draft.lastRun).toMatchObject({ status: "FAILED", hasRawResponse: true });
    expect(report.draft.draftedAt).toBeNull();
  });

  it("explains a missing API key without calling the API", async () => {
    const send = scriptedSender(fakeMessage(GOOD));
    const failure = await narrative(send, { configured: false, message: "ANTHROPIC_API_KEY is not set in .env.local." })
      .draft(projectId)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AiStepError);
    expect((failure as AiStepError).code).toBe("NO_API_KEY");
    expect(send.requests).toHaveLength(0);
  });

  it("refuses a second draft while one is running, and expires a run cut off by a restart", async () => {
    await testDb.db.aiRun.create({
      data: { projectId, kind: "NARRATIVE", model: "claude-test-model", status: "RUNNING", durationMs: 0, promptVersion: "narrative.v1" },
    });
    const running = await narrative(scriptedSender(fakeMessage(GOOD))).draft(projectId).catch((error: unknown) => error);
    expect(running).toBeInstanceOf(ConflictError);
    expect((running as ConflictError).code).toBe("DRAFT_RUNNING");
    expect((await reports().get(projectId)).draft.running).toBe(true);

    const later = new Date(Date.now() + 11 * 60 * 1000);
    const report = await reportService({ db: testDb.db, now: () => later }).get(projectId);
    expect(report.draft.running).toBe(false);
    expect(report.draft.lastRun).toMatchObject({ status: "FAILED", error: expect.stringContaining("Interrupted") });
  });
});

describe("narrativeService.save and reset", () => {
  it("logs an employee text as edited and keeps the AI original apart", async () => {
    const { report } = await narrative(scriptedSender(fakeMessage(GOOD))).draft(projectId);
    const m01 = zoneIdOf(report, "M01");
    const updated = await narrative(scriptedSender()).save(projectId, {
      section: "recommendation",
      itemKey: m01,
      text: "  M01 pipe insulation, B01 mechanical room (S01): the insulation must be removed.  ",
    });

    expect(updated.model.recommendations[0].narrative).toMatchObject({
      source: "EDITED",
      text: "M01 pipe insulation, B01 mechanical room (S01): the insulation must be removed.",
      aiText: expect.stringContaining("priority professional review"),
    });
    expect(updated.warnings).toEqual([expect.objectContaining({ code: "FORBIDDEN_CLAIM", section: "recommendation", itemKey: m01 })]);
  });

  it("counts a text equal to the AI draft as the AI draft again", async () => {
    const { report } = await narrative(scriptedSender(fakeMessage(GOOD))).draft(projectId);
    const block = report.model.executiveSummary.narrative;
    const service = narrative(scriptedSender());
    await service.save(projectId, { section: "executiveSummary", itemKey: "", text: "Changed." });
    const back = await service.save(projectId, { section: "executiveSummary", itemKey: "", text: block.aiText ?? "" });
    expect(back.model.executiveSummary.narrative.source).toBe("AI_DRAFT");
  });

  it("lets the employee write a text without an AI draft, which cannot be reset", async () => {
    const service = narrative(scriptedSender());
    const report = await service.save(projectId, { section: "limitations", itemKey: "", text: "The roof was not inspected." });
    expect(report.model.scopeLimitations.narrative).toEqual({ section: "limitations", itemKey: "", text: "The roof was not inspected.", aiText: null, source: "EDITED" });
    await expect(service.reset(projectId, { section: "limitations", itemKey: "" })).rejects.toBeInstanceOf(ConflictError);

    const cleared = await service.save(projectId, { section: "limitations", itemKey: "", text: "  " });
    expect(cleared.model.scopeLimitations.narrative.source).toBe("NONE");
    expect(await testDb.db.reportNarrative.count({ where: { projectId } })).toBe(0);
  });

  it("rejects a slot that does not exist", async () => {
    const service = narrative(scriptedSender());
    await expect(service.save(projectId, { section: "recommendation", itemKey: "no-such-zone", text: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.save(projectId, { section: "limitations", itemKey: "zone", text: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.save(projectId, { section: "summary", itemKey: "", text: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.save(projectId, { section: "limitations", itemKey: "", text: "x".repeat(6001) })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("data changes after a draft", () => {
  it("marks the draft outdated when a fact changes and drops the texts of a deleted zone", async () => {
    const { projectId: otherId } = await createReviewedProject(testDb.db, storageDir, "ORTAM-DEMO-001-B", SUPPLIED_LAB_FILES);
    const { report } = await narrative(scriptedSender(fakeMessage(GOOD))).draft(otherId);
    const m05 = zoneIdOf(report, "M05");
    const m07 = zoneIdOf(report, "M07");

    await projectService(testDb.db).updateZone(otherId, m05, { quantity: 35 });
    const changed = await reports().get(otherId);
    expect(changed.draft.outdated).toBe(true);
    expect(changed.model.executiveSummary.factsParagraph).toContain("prices 4 zones");
    // The draft said M05 was not measured; the quantity is now a fact, so 35 is supported, but the text is stale.
    expect(changed.model.findings[4].narrative.uncertainty.text).toBe("The quantity of M05 was not measured, so it is not priced.");

    await projectService(testDb.db).removeZone(otherId, m07);
    expect(await testDb.db.reportNarrative.count({ where: { projectId: otherId, itemKey: m07 } })).toBe(0);
  }, 60_000);
});

describe("reportService.saveChecklist", () => {
  it("stores the checklist and states it in the report", async () => {
    const report = await reports().saveChecklist(projectId, {
      samplesChecked: true,
      layersChecked: true,
      quantitiesChecked: true,
      costsChecked: false,
      narrativeChecked: false,
      reviewerName: "  A. Reviewer ",
      reviewedOn: "2026-10-19",
    });
    expect(report.model.employeeReview.statusLine).toBe(
      "Draft pending human and professional review. Checked: Sample matching, Layers and Quantities. Not yet checked: Costs and Narrative. Reviewer: A. Reviewer, 2026-10-19.",
    );
    expect(report.model.status).toBe("Draft pending human and professional review");

    const cleared = await reports().saveChecklist(projectId, { ...report.model.employeeReview.checklist.reduce((all, item) => ({ ...all, [item.key]: false }), {}), reviewerName: "", reviewedOn: null });
    expect(cleared.model.employeeReview.reviewerName).toBeNull();
  });

  it("rejects a date that is not a calendar day", async () => {
    await expect(
      reports().saveChecklist(projectId, {
        samplesChecked: false,
        layersChecked: false,
        quantitiesChecked: false,
        costsChecked: false,
        narrativeChecked: false,
        reviewerName: null,
        reviewedOn: "19.10.2026",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
