import { mkdtempSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "@/server/errors";
import { MAX_UPLOAD_BYTES, STALE_EXTRACTION_MS, labDocumentService, type UploadFile } from "@/server/services/labDocumentService";
import { sha256Hex } from "@/server/storage/uploads";
import { configuredKey, fakeMessage, loadAiFixture, scriptedSender } from "../helpers/fakeAi";
import { createTestDb, type TestDb } from "../helpers/testDb";

let testDb: TestDb;
let storageDir: string;
let labA: Uint8Array;
let labB: Uint8Array;

const recordedA = JSON.stringify(loadAiFixture("lab-a.recorded").output);

beforeAll(async () => {
  testDb = createTestDb();
  storageDir = mkdtempSync(path.join(tmpdir(), "ortam-storage-"));
  labA = new Uint8Array(await readFile("fixtures/LAB-A_fictional_lab_report.pdf"));
  labB = new Uint8Array(await readFile("fixtures/LAB-B_fictional_lab_report.pdf"));
});

afterAll(async () => {
  await testDb.cleanup();
  rmSync(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await testDb.db.project.deleteMany();
});

const pdfFile = (name: string, bytes: Uint8Array, type = "application/pdf"): UploadFile => ({
  name,
  type,
  size: bytes.byteLength,
  read: async () => bytes,
});

/** A service whose AI answers are scripted and whose background work runs when the test says so. */
function harness(...answers: Parameters<typeof scriptedSender>) {
  const send = scriptedSender(...(answers.length > 0 ? answers : [fakeMessage(recordedA)]));
  const queue: (() => Promise<void>)[] = [];
  let now = new Date("2026-10-19T10:00:00Z");
  const service = labDocumentService({
    db: testDb.db,
    storageDir,
    extraction: () => ({ model: "claude-test-model", keyStatus: configuredKey, send }),
    schedule: (task) => queue.push(task),
    now: () => now,
  });
  return {
    service,
    send,
    /** Runs everything scheduled after the "response". */
    async drain() {
      while (queue.length > 0) await queue.shift()!();
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

async function createProject(code = "ORTAM-DEMO-001") {
  return testDb.db.project.create({ data: { code, client: "Client", building: "Building" } });
}

describe("lab document upload", () => {
  it("stores the PDF once, read-only, and extracts it after the response", async () => {
    const project = await createProject();
    const { service, send, drain } = harness();

    const [outcome] = await service.upload(project.id, [pdfFile("LAB-A_fictional_lab_report.pdf", labA)]);
    expect(outcome.outcome).toBe("created");
    if (outcome.outcome !== "created") return;
    expect(outcome.document).toMatchObject({ status: "UPLOADED", pageCount: 1, sha256: sha256Hex(labA), results: [] });
    expect(send.requests).toHaveLength(0);

    await drain();
    const [document] = await service.list(project.id);
    expect(document.status).toBe("NEEDS_REVIEW");
    expect(document.labReportId).toBe("LAB-A");
    expect(document.results.map((row) => `${row.sampleId} ${row.layer} ${row.resultLabel}`)).toEqual([
      "S01 Insulation DETECTED",
      "S02 Floor tile NOT_DETECTED",
      "S02 Black adhesive DETECTED",
      "S03 Textured coating DETECTED",
    ]);
    expect(document.results.every((row) => row.evidenceVerified && row.flags.length === 0 && row.reviewStatus === "PENDING")).toBe(true);
    expect(document.extractedBy).toMatchObject({ model: "claude-test-model", status: "SUCCEEDED", inputTokens: 1200, outputTokens: 300 });

    const stored = path.join(storageDir, "uploads", `${sha256Hex(labA)}.pdf`);
    expect(new Uint8Array(await readFile(stored))).toEqual(labA);
    expect(statSync(stored).mode & 0o222).toBe(0);

    const results = await testDb.db.labResult.findMany();
    expect(results.every((row) => row.origin === "AI" && row.aiJson !== null)).toBe(true);
  });

  it("does not create a document, results or an AI call when the same PDF is uploaded again", async () => {
    const project = await createProject();
    const { service, send, drain } = harness();
    await service.upload(project.id, [pdfFile("LAB-A_fictional_lab_report.pdf", labA)]);
    await drain();

    const [again] = await service.upload(project.id, [pdfFile("renamed-copy.pdf", labA)]);
    await drain();

    expect(again.outcome).toBe("duplicate");
    if (again.outcome !== "duplicate") return;
    expect(again.document.fileName).toBe("LAB-A_fictional_lab_report.pdf");
    expect(again.document.status).toBe("NEEDS_REVIEW");
    expect(await testDb.db.labDocument.count()).toBe(1);
    expect(await testDb.db.labResult.count()).toBe(4);
    expect(await testDb.db.aiRun.count()).toBe(1);
    expect(send.requests).toHaveLength(1);
  });

  it("de-duplicates per project: another project gets its own document from the same stored file", async () => {
    const first = await createProject("P-1");
    const second = await createProject("P-2");
    const { service, drain } = harness();
    await service.upload(first.id, [pdfFile("a.pdf", labA)]);
    const [outcome] = await service.upload(second.id, [pdfFile("a.pdf", labA)]);
    await drain();
    expect(outcome.outcome).toBe("created");
    const documents = await testDb.db.labDocument.findMany();
    expect(documents).toHaveLength(2);
    expect(new Set(documents.map((document) => document.storagePath)).size).toBe(1);
  });

  it("gives every file its own outcome and rejects what is not a usable PDF", async () => {
    const project = await createProject();
    const { service } = harness();
    let readTooBig = false;
    const outcomes = await service.upload(project.id, [
      pdfFile("notes.txt", new TextEncoder().encode("hello"), "text/plain"),
      pdfFile("fake.pdf", new TextEncoder().encode("hello, not a pdf")),
      { name: "huge.pdf", type: "application/pdf", size: MAX_UPLOAD_BYTES + 1, read: async () => ((readTooBig = true), labA) },
      pdfFile("broken.pdf", new TextEncoder().encode("%PDF-1.4 garbage")),
      pdfFile("../../LAB-B.pdf", labB),
    ]);
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["rejected", "rejected", "rejected", "rejected", "created"]);
    expect(outcomes[0]).toMatchObject({ error: expect.stringContaining("is not a PDF") });
    expect(outcomes[2]).toMatchObject({ error: expect.stringContaining("larger than 10 MB") });
    expect(outcomes[3]).toMatchObject({ error: expect.stringContaining("cannot be read") });
    expect(readTooBig).toBe(false);
    expect(outcomes[4].fileName).toBe("LAB-B.pdf");
    expect(await testDb.db.labDocument.count()).toBe(1);
  });

  it("marks a PDF without selectable text as failed, without an AI call or a Retry", async () => {
    const project = await createProject();
    const { service, send, drain } = harness();
    const blank = await PDFDocument.create();
    blank.addPage();
    const [outcome] = await service.upload(project.id, [pdfFile("scan.pdf", await blank.save())]);
    await drain();

    expect(outcome.outcome === "created" && outcome.document).toMatchObject({
      status: "FAILED",
      errorCode: "NO_TEXT",
      retryable: false,
      error: "No selectable text found (scanned PDFs are out of scope).",
    });
    expect(send.requests).toHaveLength(0);
    if (outcome.outcome !== "created") return;
    await expect(service.startExtraction(project.id, outcome.document.id, { replaceReviewed: false })).rejects.toBeInstanceOf(ConflictError);
  });

  it("answers 404 for a project that does not exist", async () => {
    const { service } = harness();
    await expect(service.upload("missing", [pdfFile("a.pdf", labA)])).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("lab document extraction", () => {
  async function extracted(...answers: Parameters<typeof scriptedSender>) {
    const project = await createProject();
    const context = harness(fakeMessage(recordedA), ...answers);
    const [outcome] = await context.service.upload(project.id, [pdfFile("LAB-A.pdf", labA)]);
    await context.drain();
    if (outcome.outcome !== "created") throw new Error("upload failed");
    return { ...context, projectId: project.id, documentId: outcome.document.id };
  }

  it("replaces the earlier AI rows when extracting again instead of adding to them", async () => {
    const { service, drain, projectId, documentId } = await extracted(fakeMessage(recordedA));
    const before = await testDb.db.labResult.findMany({ select: { id: true } });

    const started = await service.startExtraction(projectId, documentId, { replaceReviewed: false });
    expect(started.status).toBe("EXTRACTING");
    expect(started.results).toEqual([]);
    await drain();

    const after = await testDb.db.labResult.findMany({ select: { id: true, aiRunId: true } });
    expect(after).toHaveLength(4);
    expect(after.some((row) => before.some((old) => old.id === row.id))).toBe(false);
    expect(await testDb.db.aiRun.count()).toBe(2);
    expect((await service.get(projectId, documentId)).status).toBe("NEEDS_REVIEW");
  });

  it("refuses a second extraction while one is running", async () => {
    const { service, projectId, documentId } = await extracted();
    await service.startExtraction(projectId, documentId, { replaceReviewed: false });
    await expect(service.startExtraction(projectId, documentId, { replaceReviewed: false })).rejects.toThrow("already running");
  });

  it("keeps accepted rows unless the employee confirms replacing them", async () => {
    const { service, drain, projectId, documentId } = await extracted(fakeMessage(recordedA));
    const adhesive = await testDb.db.labResult.findFirstOrThrow({ where: { layer: "Black adhesive" } });
    await testDb.db.labResult.update({ where: { id: adhesive.id }, data: { reviewStatus: "ACCEPTED" } });

    const refusal = await service.startExtraction(projectId, documentId, { replaceReviewed: false }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ConflictError);
    expect((refusal as ConflictError).code).toBe("REVIEWED_RESULTS");
    expect(await testDb.db.labResult.findUnique({ where: { id: adhesive.id } })).not.toBeNull();

    await service.startExtraction(projectId, documentId, { replaceReviewed: true });
    await drain();
    expect(await testDb.db.labResult.findUnique({ where: { id: adhesive.id } })).toBeNull();
    expect(await testDb.db.labResult.count()).toBe(4);
  });

  it("treats a corrected row as reviewed too", async () => {
    const { service, projectId, documentId } = await extracted();
    const row = await testDb.db.labResult.findFirstOrThrow();
    await testDb.db.correction.create({
      data: { projectId, entity: "LabResult", entityId: row.id, field: "layer", oldValue: '"a"', newValue: '"b"', reason: "typo" },
    });
    await expect(service.startExtraction(projectId, documentId, { replaceReviewed: false })).rejects.toThrow("accepted or corrected");
  });

  it("shows a failed retry as failed, with a readable reason and no results", async () => {
    const rateLimited = Anthropic.APIError.generate(429, { error: { message: "slow down" } }, "slow down", new Headers());
    const { service, drain, projectId, documentId } = await extracted(rateLimited);
    await service.startExtraction(projectId, documentId, { replaceReviewed: false });
    await drain();

    const document = await service.get(projectId, documentId);
    expect(document).toMatchObject({ status: "FAILED", errorCode: "RATE_LIMIT", retryable: true, results: [], warnings: [] });
    expect(document.error).toContain("rate limit");
    expect(document.lastRun?.status).toBe("FAILED");
    expect(document.extractedBy).toBeNull();
  });

  it("turns an extraction cut off by a restart into a failure with Retry", async () => {
    const { service, advance, projectId, documentId } = await extracted();
    await service.startExtraction(projectId, documentId, { replaceReviewed: false });
    // The scheduled work never runs, as after a server restart.
    advance(STALE_EXTRACTION_MS + 1000);
    const [document] = await service.list(projectId);
    expect(document).toMatchObject({ status: "FAILED", errorCode: "INTERRUPTED", retryable: true });
  });

  it("serves the raw AI response of a run in the same project only", async () => {
    const { service, projectId, documentId } = await extracted();
    const runId = (await service.get(projectId, documentId)).extractedBy!.id;
    const run = await service.getAiRun(projectId, runId);
    expect(JSON.parse(run.rawResponse ?? "{}").content[0].text).toBe(recordedA);
    const other = await createProject("OTHER");
    await expect(service.getAiRun(other.id, runId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
