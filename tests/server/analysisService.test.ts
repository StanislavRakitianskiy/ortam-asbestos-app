import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { formatCad } from "@/domain/format";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { analysisService, type ProjectAnalysisDto } from "@/server/services/analysisService";
import { labDocumentService } from "@/server/services/labDocumentService";
import { labReviewService } from "@/server/services/labReviewService";
import { LAB_X_FILE, SUPPLIED_LAB_FILES, createReviewedProject, type LabFile } from "../helpers/reviewedProject";
import { createTestDb, type TestDb } from "../helpers/testDb";

/**
 * Integration: the supplied lab PDFs go through upload, text extraction, the recorded AI answers, evidence checks and
 * "Accept all verified"; the analysis is then read back from the database.
 */

let testDb: TestDb;
let storageDir: string;

beforeAll(() => {
  testDb = createTestDb();
  storageDir = mkdtempSync(path.join(tmpdir(), "ortam-storage-"));
});

afterAll(async () => {
  await testDb.cleanup();
  rmSync(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await testDb.db.project.deleteMany();
});

const SUPPLIED = SUPPLIED_LAB_FILES;
const LAB_X = LAB_X_FILE;

/** A project with the supplied material register and the given lab reports uploaded, extracted and accepted. */
async function reviewedProject(code: string, files: readonly LabFile[]) {
  const { projectId, documentIds } = await createReviewedProject(testDb.db, storageDir, code, files);
  return { projectId, documentIds, review: labReviewService(testDb.db), analysis: analysisService(testDb.db) };
}

const zoneRow = (analysis: ProjectAnalysisDto, materialId: string) => {
  const found = analysis.zones.find((zone) => zone.zone.materialId === materialId);
  if (!found) throw new Error(`no zone ${materialId}`);
  return found;
};

const costText = (cost: ProjectAnalysisDto["zones"][number]["cost"]) =>
  cost.status === "PRICED" ? formatCad(cost.lineTotal) : cost.status === "NOT_PRICED" ? `Not priced (${cost.reason})` : "No cost line";

describe("analysisService on ORTAM-DEMO-001 with the recorded, accepted LAB-A/B/C results", () => {
  it("reproduces the golden statuses, categories and amounts", async () => {
    const { projectId, analysis } = await reviewedProject("ORTAM-DEMO-001", SUPPLIED);
    const result = await analysis.get(projectId);

    expect(result.zones.map((zone) => [zone.zone.materialId, zone.zoneStatus, zone.categorization.category, costText(zone.cost)])).toEqual([
      ["M01", "DETECTED", "A", "3,840.00"],
      ["M02", "DETECTED", "A", "7,200.00"],
      ["M03", "DETECTED", "A", "12,600.00"],
      ["M04", "NOT_DETECTED", "D", "No cost line"],
      ["M05", "DETECTED", "B", "Not priced (MISSING_QUANTITY)"],
      ["M06", "INCONCLUSIVE", "C", "Not priced (UNRESOLVED)"],
      ["M07", "INACCESSIBLE", "C", "Not priced (UNRESOLVED)"],
    ]);
    const { estimate } = result;
    expect({
      zone: formatCad(estimate.zoneSubtotal),
      removal: formatCad(estimate.removalSubtotal),
      replacement: formatCad(estimate.replacementSubtotal),
      direct: formatCad(estimate.direct),
      contingency: formatCad(estimate.contingency),
      total: formatCad(estimate.total),
    }).toEqual({ zone: "23,640.00", removal: "15,330.00", replacement: "8,310.00", direct: "27,340.00", contingency: "5,468.00", total: "32,808.00" });

    // M03: S03 (LAB-A) and S07 (LAB-C) kept as two samples, 140 m2 charged once.
    expect(zoneRow(result, "M03").samples.map((sample) => [sample.sampleId, sample.layers[0].results[0].labReportId])).toEqual([
      ["S03", "LAB-A"],
      ["S07", "LAB-C"],
    ]);
    expect(estimate.lines.filter((line) => line.materialId === "M03")).toHaveLength(1);
    // S02: both layers kept with their sources.
    expect(zoneRow(result, "M02").samples[0].layers.map((layer) => [layer.layer, layer.status, layer.results[0].fileName, layer.results[0].page])).toEqual([
      ["Floor tile", "NOT_DETECTED", "LAB-A_fictional_lab_report.pdf", 1],
      ["Black adhesive", "DETECTED", "LAB-A_fictional_lab_report.pdf", 1],
    ]);

    expect(result.issues.map((found) => [found.type, found.severity, found.state])).toEqual([
      ["MISSING_QUANTITY", "warning", "INFO"],
      ["INCONCLUSIVE_RESULT", "warning", "INFO"],
      ["INACCESSIBLE_ZONE", "warning", "INFO"],
    ]);
    expect(result.readiness).toMatchObject({ status: "READY", label: "Ready to generate", canGenerate: true });
  });

  it("blocks while a lab report is still in review and uses none of its rows", async () => {
    const { projectId, documentIds, review, analysis } = await reviewedProject("ORTAM-DEMO-001", SUPPLIED);
    const labC = (await labDocumentService({ db: testDb.db, storageDir }).get(projectId, documentIds["lab-c.recorded"])).results[0];
    await review.decide(projectId, documentIds["lab-c.recorded"], labC.id, { decision: "REOPEN" });

    const result = await analysis.get(projectId);
    expect(result.issues[0]).toMatchObject({ type: "LAB_REPORT_NOT_REVIEWED", state: "OPEN" });
    expect(result.issues.map((found) => found.type)).toContain("MISSING_LAB_RESULT");
    expect(zoneRow(result, "M03").samples[1]).toMatchObject({ sampleId: "S07", status: "AWAITING_RESULT", layers: [] });
    expect(result.readiness.label).toBe("Blocked: 2 open items");
  });
});

describe("analysisService on ORTAM-DEMO-001-EDGE with the LAB-X test fixture", () => {
  it("raises UNMATCHED_LAB_SAMPLE for S7 and CONFLICTING_RESULT for S04, and links nothing automatically", async () => {
    const { projectId, analysis } = await reviewedProject("ORTAM-DEMO-001-EDGE", [...SUPPLIED, LAB_X]);
    const result = await analysis.get(projectId);

    const blocking = result.issues.filter((found) => found.severity === "blocking");
    expect(blocking.map((found) => [found.key, found.type, found.state])).toEqual([
      ["CONFLICTING_RESULT:S04:plaster", "CONFLICTING_RESULT", "OPEN"],
      ["UNMATCHED_LAB_SAMPLE:S7", "UNMATCHED_LAB_SAMPLE", "OPEN"],
    ]);
    const conflict = blocking[0];
    expect(conflict.message).toContain("Not detected in LAB-B");
    expect(conflict.message).toContain("Detected in LAB-X");
    expect(conflict.refs.zoneIds).toEqual([zoneRow(result, "M04").zone.id]);

    expect(result.unmatchedSamples).toHaveLength(1);
    expect(result.unmatchedSamples[0]).toMatchObject({
      sampleId: "S7",
      similar: [{ sampleId: "S07", zones: [{ materialId: "M03" }] }],
    });
    expect(result.unmatchedSamples[0].rows.map((row) => [row.fileName, row.page, row.sourceText])).toEqual([
      ["LAB-X_edge_cases.pdf", 1, "S7  Textured coating  Detected  Chrysotile  1%"],
    ]);
    // S7 is not counted for M03; M04 is unresolved while the conflict stands.
    expect(zoneRow(result, "M03").samples.flatMap((sample) => sample.layers.flatMap((layer) => layer.results.map((row) => row.labReportId)))).toEqual([
      "LAB-A",
      "LAB-C",
    ]);
    expect([zoneRow(result, "M04").zoneStatus, zoneRow(result, "M04").categorization.category]).toEqual(["CONFLICT", "C"]);
    expect(formatCad(result.estimate.total)).toBe("32,808.00");
    expect(result.readiness).toMatchObject({ status: "BLOCKED", label: "Blocked: 2 open items", canGenerate: false });
  });

  it("stores decisions by issue key: they survive recomputation, feed the limitations and move Project.updatedAt", async () => {
    const { projectId, analysis } = await reviewedProject("ORTAM-DEMO-001-EDGE", [...SUPPLIED, LAB_X]);
    const before = await testDb.db.project.findUniqueOrThrow({ where: { id: projectId } });

    await analysis.decide(projectId, { issueKey: "UNMATCHED_LAB_SAMPLE:S7", decision: "RESOLVED", note: "Lab confirmed S7 belongs to another site." });
    const flagged = await analysis.decide(projectId, {
      issueKey: "CONFLICTING_RESULT:S04:plaster",
      decision: "FLAGGED",
      note: "LAB-B and LAB-X disagree; re-test requested.",
    });

    expect(flagged.readiness).toMatchObject({ status: "DRAFT_WITH_FLAGS", label: "Draft with 1 flagged item", canGenerate: true });
    expect(flagged.flaggedLimitations).toEqual([
      expect.objectContaining({ issueKey: "CONFLICTING_RESULT:S04:plaster", note: "LAB-B and LAB-X disagree; re-test requested." }),
    ]);
    // A decision changes no data.
    expect(zoneRow(flagged, "M04").categorization.category).toBe("C");

    const again = await analysis.get(projectId);
    expect(again.issues.filter((found) => found.severity === "blocking").map((found) => [found.key, found.state])).toEqual([
      ["CONFLICTING_RESULT:S04:plaster", "FLAGGED"],
      ["UNMATCHED_LAB_SAMPLE:S7", "RESOLVED"],
    ]);
    const after = await testDb.db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

    // Changing a decision overwrites it; reopening removes it.
    const changed = await analysis.decide(projectId, { issueKey: "UNMATCHED_LAB_SAMPLE:S7", decision: "FLAGGED", note: "Unclear." });
    expect(changed.issues.find((found) => found.key === "UNMATCHED_LAB_SAMPLE:S7")?.state).toBe("FLAGGED");
    const reopened = await analysis.reopen(projectId, { issueKey: "UNMATCHED_LAB_SAMPLE:S7" });
    expect(reopened.issues.find((found) => found.key === "UNMATCHED_LAB_SAMPLE:S7")?.state).toBe("OPEN");
    expect(await testDb.db.reviewIssueResolution.count({ where: { projectId } })).toBe(1);
  });

  it("auto-clears decisions when the employee corrects the data (S7 → S07, wrong S04 row rejected)", async () => {
    const { projectId, documentIds, review, analysis } = await reviewedProject("ORTAM-DEMO-001-EDGE", [...SUPPLIED, LAB_X]);
    await analysis.decide(projectId, { issueKey: "UNMATCHED_LAB_SAMPLE:S7", decision: "FLAGGED", note: "Probably S07." });
    await analysis.decide(projectId, { issueKey: "CONFLICTING_RESULT:S04:plaster", decision: "FLAGGED", note: "Asked the lab." });

    const labX = documentIds["lab-x.handwritten"];
    const rows = (await labDocumentService({ db: testDb.db, storageDir }).get(projectId, labX)).results;
    const s7 = rows.find((row) => row.sampleId === "S7")!;
    const s04 = rows.find((row) => row.sampleId === "S04")!;
    await review.correct(projectId, labX, s7.id, { changes: { sampleId: "S07" }, reason: "Register and label read S07", accept: true });
    await review.decide(projectId, labX, s04.id, { decision: "REJECT", reason: "Lab withdrew this result" });

    const result = await analysis.get(projectId);
    expect(result.unmatchedSamples).toEqual([]);
    expect(result.autoCleared.map((cleared) => [cleared.issueKey, cleared.note])).toEqual([
      ["UNMATCHED_LAB_SAMPLE:S7", "Probably S07."],
      ["CONFLICTING_RESULT:S04:plaster", "Asked the lab."],
    ]);
    // The corrected S07 row joins M03 as a second agreeing source; the zone is still charged once.
    expect(zoneRow(result, "M03").samples[1].layers[0].results.map((row) => row.labReportId)).toEqual(["LAB-C", "LAB-X"]);
    expect(costText(zoneRow(result, "M03").cost)).toBe("12,600.00");
    expect([zoneRow(result, "M04").zoneStatus, zoneRow(result, "M04").categorization.category]).toEqual(["NOT_DETECTED", "D"]);

    // The lab still prints "S7" on the cited line, so the relabelled row needs an explicit decision before the report.
    const blocking = result.issues.filter((found) => found.severity === "blocking");
    expect(blocking.map((found) => [found.key, found.state])).toEqual([[`EVIDENCE_NOT_VERIFIED:${s7.id}`, "OPEN"]]);
    expect(blocking[0].message).toContain("The cited line does not contain the sample ID S07.");
    expect(blocking[0].refs.zoneIds).toEqual([zoneRow(result, "M03").zone.id]);
    const confirmed = await analysis.decide(projectId, {
      issueKey: blocking[0].key,
      decision: "RESOLVED",
      note: "LAB-X printed S7 for sample S07; confirmed with the lab.",
    });
    expect(confirmed.readiness.status).toBe("READY");

    // A cleared decision can be dropped.
    const dropped = await analysis.reopen(projectId, { issueKey: "UNMATCHED_LAB_SAMPLE:S7" });
    expect(dropped.autoCleared.map((cleared) => cleared.issueKey)).toEqual(["CONFLICTING_RESULT:S04:plaster"]);
  });

  it("refuses decisions on warnings, on issues that no longer exist and without a note", async () => {
    const { projectId, analysis } = await reviewedProject("ORTAM-DEMO-001-EDGE", [...SUPPLIED, LAB_X]);
    const warning = (await analysis.get(projectId)).issues.find((found) => found.severity === "warning")!;

    await expect(analysis.decide(projectId, { issueKey: warning.key, decision: "FLAGGED", note: "x" })).rejects.toThrow(ConflictError);
    await expect(analysis.decide(projectId, { issueKey: "UNMATCHED_LAB_SAMPLE:S99", decision: "RESOLVED", note: "x" })).rejects.toMatchObject({
      code: "ISSUE_GONE",
    });
    await expect(analysis.decide(projectId, { issueKey: "UNMATCHED_LAB_SAMPLE:S7", decision: "RESOLVED", note: " " })).rejects.toThrow(ValidationError);
    await expect(analysis.reopen(projectId, { issueKey: "UNMATCHED_LAB_SAMPLE:S7" })).rejects.toThrow(NotFoundError);
    await expect(analysis.get("missing-project")).rejects.toThrow(NotFoundError);
    expect(await testDb.db.reviewIssueResolution.count()).toBe(0);
  });
});
