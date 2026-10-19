import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, ReportStepError } from "@/server/errors";
import { PdfConversionError } from "@/server/report/gotenberg";
import { narrativeService } from "@/server/services/narrativeService";
import { projectService } from "@/server/services/projectService";
import { revisionService, STALE_GENERATION_MS } from "@/server/services/revisionService";
import { docxText } from "../helpers/docxText";
import { SUPPLIED_LAB_FILES, createReviewedProject } from "../helpers/reviewedProject";
import { createTestDb, type TestDb } from "../helpers/testDb";

/**
 * Integration: the supplied lab PDFs are uploaded, extracted with the recorded answers and accepted; report revisions are
 * then generated from the database with a fake PDF converter (Gotenberg is not needed for npm test).
 */

let testDb: TestDb;
let storageDir: string;
let projectId: string;
let fakePdf: Uint8Array;
let now = new Date("2026-10-19T12:00:00Z");

beforeAll(async () => {
  testDb = createTestDb();
  storageDir = mkdtempSync(path.join(tmpdir(), "ortam-storage-"));
  ({ projectId } = await createReviewedProject(testDb.db, storageDir, "ORTAM-DEMO-001", SUPPLIED_LAB_FILES));
  const document = await PDFDocument.create();
  document.addPage();
  fakePdf = await document.save();
}, 60_000);

afterAll(async () => {
  await testDb.cleanup();
  rmSync(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await testDb.db.reportRevision.deleteMany();
  rmSync(path.join(storageDir, "reports"), { recursive: true, force: true });
  now = new Date(now.getTime() + 60_000);
});

const converted: Uint8Array[] = [];

function revisions(convert: (docx: Uint8Array) => Promise<Uint8Array> = async (docx) => (converted.push(docx), fakePdf)) {
  return revisionService({ db: testDb.db, storageDir, convert, now: () => now });
}

const zoneId = async (materialId: string) => (await testDb.db.materialZone.findFirstOrThrow({ where: { projectId, materialId } })).id;

async function setQuantity(materialId: string, quantity: number | null) {
  await projectService(testDb.db).updateZone(projectId, await zoneId(materialId), { quantity });
}

describe("generating a report revision", () => {
  it("renders the snapshot to DOCX and PDF, stores both read-only and serves them", async () => {
    const result = await revisions().generate(projectId);
    expect(result.created).toBe(true);
    expect(result.revision).toMatchObject({ number: 1, status: "READY", error: null, docxFileName: "ORTAM-DEMO-001_rev1.docx", pdfFileName: "ORTAM-DEMO-001_rev1.pdf" });
    expect(result.status.state).toBe("current");

    const folder = path.join(storageDir, "reports", projectId, "rev-1");
    for (const name of ["report.docx", "report.pdf"]) expect(statSync(path.join(folder, name)).mode & 0o222).toBe(0);

    const docx = await revisions().getFile(result.revision.id, "docx");
    const text = docxText(docx.bytes);
    expect(text).toContain("32,808.00");
    expect(text).toContain(`Report ORTAM-DEMO-001 | Revision 1 | Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC | Snapshot ${result.revision.snapshotHash.slice(0, 12)}`);
    // The PDF is the converter's answer for exactly this DOCX.
    expect(converted.at(-1)).toEqual(docx.bytes);
    expect((await revisions().getFile(result.revision.id, "pdf")).bytes).toEqual(fakePdf);
  });

  it("does not generate again while nothing changed", async () => {
    const first = await revisions().generate(projectId);
    const second = await revisions().generate(projectId);
    expect(second.created).toBe(false);
    expect(second.revision.id).toBe(first.revision.id);
    expect(await testDb.db.reportRevision.count()).toBe(1);
  });

  it("marks the revision outdated after a data change, and the next one current", async () => {
    const first = await revisions().generate(projectId);
    try {
      await setQuantity("M05", 12);
      const status = await revisions().status(projectId);
      expect(status.state).toBe("outdated");
      expect(status.latestReady?.id).toBe(first.revision.id);
      expect(status.currentHash).not.toBe(first.revision.snapshotHash);

      const second = await revisions().generate(projectId);
      expect([second.created, second.revision.number, second.status.state]).toEqual([true, 2, "current"]);
      // The older revision can still be downloaded; the UI labels it as outdated.
      expect((await revisions().getFile(first.revision.id, "docx")).fileName).toBe("ORTAM-DEMO-001_rev1.docx");
    } finally {
      await setQuantity("M05", null);
    }
    // Back to the data of revision 1: the latest ready revision (2) is outdated, not revision 1 current again.
    expect((await revisions().status(projectId)).state).toBe("outdated");
  });

  it("stores a failed step as FAILED with the message, keeps no files and serves none", async () => {
    await revisions().generate(projectId);
    await setQuantity("M05", 12);
    try {
      const failing = revisions(async () => {
        throw new PdfConversionError("PDF converter is not running — start it with docker compose up -d", "CONVERTER_UNAVAILABLE");
      });
      await expect(failing.generate(projectId)).rejects.toThrow(ReportStepError);
      await expect(failing.generate(projectId)).rejects.toThrow("PDF converter is not running — start it with docker compose up -d");

      const status = await revisions().status(projectId);
      expect(status.state).toBe("failed");
      expect(status.lastAttempt).toMatchObject({ number: 3, status: "FAILED", error: "PDF converter is not running — start it with docker compose up -d" });
      expect(existsSync(path.join(storageDir, "reports", projectId, "rev-2"))).toBe(false);
      await expect(revisions().getFile(status.lastAttempt!.id, "pdf")).rejects.toMatchObject({ code: "REVISION_NOT_READY" });

      // Retry is a new attempt with the next number.
      const retry = await revisions().generate(projectId);
      expect([retry.revision.number, retry.status.state]).toEqual([4, "current"]);
    } finally {
      await setQuantity("M05", null);
    }
  });

  it("fails with a readable message when the template is missing, and creates no revision", async () => {
    const missing = revisionService({ db: testDb.db, storageDir, templatePath: path.join(storageDir, "nope.docx"), convert: async () => fakePdf });
    await expect(missing.generate(projectId)).rejects.toMatchObject({ code: "TEMPLATE_MISSING" });
    expect(await testDb.db.reportRevision.count()).toBe(0);
  });
});

describe("what stops generation", () => {
  it("open blocking review items", async () => {
    const zone = await projectService(testDb.db).addZone(projectId, {
      materialId: "M99",
      description: "Test zone",
      floor: "Ground",
      location: "G09 store",
      sampleIds: ["S99"],
      quantity: 5,
      unit: "m2",
      condition: "intact",
      plannedDisturbance: false,
      rateRef: null,
      accessible: true,
      notes: "",
    });
    try {
      const status = await revisions().status(projectId);
      expect(status.canGenerate).toBe(false);
      expect(status.blockers[0]).toMatch(/^Blocked: \d+ open items?\. Resolve each open item or keep it flagged in Matching/);
      await expect(revisions().generate(projectId)).rejects.toMatchObject({ code: "REPORT_BLOCKED" });
      expect(await testDb.db.reportRevision.count()).toBe(0);
    } finally {
      await projectService(testDb.db).removeZone(projectId, zone.id);
    }
  });

  it("a narrative claim the report must not make", async () => {
    const narrative = narrativeService({ db: testDb.db });
    await narrative.save(projectId, { section: "executiveSummary", itemKey: "", text: "The building is asbestos-free." });
    try {
      const error = await revisions().generate(projectId).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).message).toMatch(/claim the report must not make/);
    } finally {
      await testDb.db.reportNarrative.deleteMany({ where: { projectId } });
    }
  });

  it("a revision that is being generated", async () => {
    await setQuantity("M05", 12);
    try {
      await testDb.db.reportRevision.create({
        data: { projectId, number: 1, snapshotJson: "{}", snapshotHash: "x", status: "GENERATING", createdAt: now },
      });
      expect((await revisions().status(projectId)).state).toBe("generating");
      await expect(revisions().generate(projectId)).rejects.toMatchObject({ code: "GENERATION_RUNNING" });
    } finally {
      await setQuantity("M05", null);
    }
  });

  it("not a revision cut off by a server restart: it becomes FAILED", async () => {
    await testDb.db.reportRevision.create({
      data: { projectId, number: 1, snapshotJson: "{}", snapshotHash: "x", status: "GENERATING", createdAt: new Date(now.getTime() - STALE_GENERATION_MS - 1) },
    });
    const status = await revisions().status(projectId);
    expect(status.state).toBe("failed");
    expect(status.lastAttempt?.error).toMatch(/^Interrupted/);
    expect((await revisions().generate(projectId)).revision.number).toBe(2);
  });
});
