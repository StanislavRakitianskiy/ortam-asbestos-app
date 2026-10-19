import { describe, expect, it } from "vitest";
import { analyzeProject, type AnalysisInput } from "@/domain/analysis";
import { formatCad } from "@/domain/format";
import { refsKey, type StoredResolution } from "@/domain/issueResolution";
import type { LabDocumentState } from "@/domain/labRowIssues";
import type { AcceptedLabResult } from "@/domain/types";
import { demoResults, demoZones, labRow } from "../fixtures/demoProject";

const DOCUMENTS: LabDocumentState[] = ["LAB-A", "LAB-B", "LAB-C"].map((id) => ({
  id: `doc-${id.toLowerCase()}`,
  fileName: `${id}_fictional_lab_report.pdf`,
  labReportId: id,
  status: "ACCEPTED",
  pendingRows: 0,
}));

/** TEST FIXTURE rows as printed in fixtures/test/LAB-X_edge_cases.pdf. */
function labXRows(): AcceptedLabResult[] {
  return [
    labRow({ labReportId: "LAB-X", sampleId: "S7", layer: "Textured coating", resultLabel: "DETECTED", asbestosType: "Chrysotile", percentage: 1 }),
    labRow({ labReportId: "LAB-X", sampleId: "S04", layer: "Plaster", resultLabel: "DETECTED", asbestosType: "Chrysotile", percentage: 3 }),
  ];
}
const LAB_X: LabDocumentState = { id: "doc-lab-x", fileName: "LAB-X_test_report.pdf", labReportId: "LAB-X", status: "ACCEPTED", pendingRows: 0 };

function input(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  const results = overrides.results ?? demoResults();
  return {
    zones: demoZones(),
    results,
    evidence: results.map((row) => ({ labResultId: row.id, evidenceVerified: true, confidence: "HIGH", flags: [] })),
    documents: DOCUMENTS,
    resolutions: [],
    ...overrides,
  };
}

describe("analyzeProject on the supplied demo data (golden expectations)", () => {
  const analysis = analyzeProject(input());

  it("derives status, category and cost for every zone", () => {
    expect(
      analysis.zones.map(({ zone, zoneStatus, categorization, cost }) => [
        zone.materialId,
        zoneStatus,
        categorization.category,
        cost.status === "PRICED" ? formatCad(cost.lineTotal) : cost.status === "NOT_PRICED" ? `Not priced: ${cost.reason}` : "No cost",
      ]),
    ).toEqual([
      ["M01", "DETECTED", "A", "3,840.00"],
      ["M02", "DETECTED", "A", "7,200.00"],
      ["M03", "DETECTED", "A", "12,600.00"],
      ["M04", "NOT_DETECTED", "D", "No cost"],
      ["M05", "DETECTED", "B", "Not priced: MISSING_QUANTITY"],
      ["M06", "INCONCLUSIVE", "C", "Not priced: UNRESOLVED"],
      ["M07", "INACCESSIBLE", "C", "Not priced: UNRESOLVED"],
    ]);
  });

  it("computes the golden totals", () => {
    const { estimate } = analysis;
    expect([estimate.zoneSubtotal, estimate.removalSubtotal, estimate.replacementSubtotal, estimate.direct, estimate.contingency, estimate.total].map(formatCad)).toEqual([
      "23,640.00",
      "15,330.00",
      "8,310.00",
      "27,340.00",
      "5,468.00",
      "32,808.00",
    ]);
  });

  it("keeps S03 and S07 as two samples of M03 and both S02 layers", () => {
    const m03 = analysis.zones[2];
    expect(m03.samples.map((sample) => sample.sampleId)).toEqual(["S03", "S07"]);
    const m02 = analysis.zones[1];
    expect(m02.samples[0].layers.map((layer) => [layer.layer, layer.status])).toEqual([
      ["Floor tile", "NOT_DETECTED"],
      ["Black adhesive", "DETECTED"],
    ]);
  });

  it("is ready to generate: only warnings, which need no decision", () => {
    expect(analysis.readiness).toMatchObject({ status: "READY", label: "Ready to generate", canGenerate: true });
    expect(analysis.issues.map((found) => [found.type, found.state])).toEqual([
      ["MISSING_QUANTITY", "INFO"],
      ["INCONCLUSIVE_RESULT", "INFO"],
      ["INACCESSIBLE_ZONE", "INFO"],
    ]);
    expect(analysis.unmatchedSamples).toEqual([]);
    expect(analysis.flaggedLimitations).toEqual([]);
  });

  it("links each zone to the issues about it", () => {
    expect(analysis.zones.map((zone) => [zone.zone.materialId, zone.issueKeys.length])).toEqual([
      ["M01", 0],
      ["M02", 0],
      ["M03", 0],
      ["M04", 0],
      ["M05", 1],
      ["M06", 1],
      ["M07", 1],
    ]);
  });
});

describe("analyzeProject with the LAB-X edge cases", () => {
  const results = [...demoResults(), ...labXRows()];
  const documents = [...DOCUMENTS, LAB_X];
  const analysis = analyzeProject(input({ results, documents }));

  it("reports S7 as unmatched with a text hint only, and the S04 plaster conflict", () => {
    const blocking = analysis.issues.filter((found) => found.severity === "blocking");
    expect(blocking.map((found) => [found.key, found.state])).toEqual([
      ["CONFLICTING_RESULT:S04:plaster", "OPEN"],
      ["UNMATCHED_LAB_SAMPLE:S7", "OPEN"],
    ]);
    expect(analysis.unmatchedSamples).toEqual([
      {
        sampleId: "S7",
        issueKey: "UNMATCHED_LAB_SAMPLE:S7",
        rows: [labXRows()[0]],
        similar: [{ sampleId: "S07", zones: [{ zoneId: "zone-m03", materialId: "M03" }] }],
      },
    ]);
    expect(analysis.readiness.label).toBe("Blocked: 2 open items");
  });

  it("never links S7 to M03: M03 keeps only S03 and S07 evidence and is charged once", () => {
    const m03 = analysis.zones[2];
    expect(m03.samples.flatMap((sample) => sample.layers.flatMap((layer) => layer.results.map((row) => row.labReportId)))).toEqual([
      "LAB-A",
      "LAB-C",
    ]);
    expect(m03.cost).toMatchObject({ status: "PRICED", lineTotal: 1_260_000 });
  });

  it("makes M04 unresolved (category C) while the conflict stands, and keeps the totals", () => {
    const m04 = analysis.zones[3];
    expect([m04.zoneStatus, m04.categorization.category, m04.cost]).toEqual(["CONFLICT", "C", { status: "NOT_PRICED", reason: "UNRESOLVED" }]);
    expect(formatCad(analysis.estimate.total)).toBe("32,808.00");
  });

  it("lets the employee flag the conflict and resolve the unmatched ID; flagged notes feed the scope limitations", () => {
    const decide = (key: string, decision: "RESOLVED" | "FLAGGED", note: string): StoredResolution => {
      const found = analysis.issues.find((item) => item.key === key)!;
      return { issueKey: key, issueType: found.type, issueMessage: found.message, refsKey: refsKey(found.refs), decision, note, decidedAt: "2026-10-19T12:00:00.000Z" };
    };
    const decided = analyzeProject(
      input({
        results,
        documents,
        resolutions: [
          decide("CONFLICTING_RESULT:S04:plaster", "FLAGGED", "LAB-B and LAB-X disagree on S04; re-test requested."),
          decide("UNMATCHED_LAB_SAMPLE:S7", "RESOLVED", "Lab confirmed S7 is not from this building."),
        ],
      }),
    );
    expect(decided.readiness).toMatchObject({ status: "DRAFT_WITH_FLAGS", label: "Draft with 1 flagged item", canGenerate: true });
    expect(decided.flaggedLimitations).toEqual([
      expect.objectContaining({ issueKey: "CONFLICTING_RESULT:S04:plaster", note: "LAB-B and LAB-X disagree on S04; re-test requested." }),
    ]);
    // A decision changes no data: M04 stays unresolved.
    expect(decided.zones[3].categorization.category).toBe("C");
  });

  it("auto-clears the S7 decision once the employee corrects the lab row to S07", () => {
    const s7 = analysis.issues.find((found) => found.key === "UNMATCHED_LAB_SAMPLE:S7")!;
    const resolution: StoredResolution = {
      issueKey: s7.key,
      issueType: s7.type,
      issueMessage: s7.message,
      refsKey: refsKey(s7.refs),
      decision: "FLAGGED",
      note: "Probably S07",
      decidedAt: "2026-10-19T12:00:00.000Z",
    };
    const corrected = results.map((row) => (row.sampleId === "S7" ? { ...row, sampleId: "S07" } : row));
    const after = analyzeProject(input({ results: corrected, documents, resolutions: [resolution] }));

    expect(after.unmatchedSamples).toEqual([]);
    expect(after.autoCleared).toEqual([expect.objectContaining({ issueKey: "UNMATCHED_LAB_SAMPLE:S7", note: "Probably S07" })]);
    // S07 now has two agreeing reports; M03 is still charged once for 140 m2.
    const s07 = after.zones[2].samples[1];
    expect(s07.layers[0].results.map((row) => row.labReportId)).toEqual(["LAB-C", "LAB-X"]);
    expect(after.zones[2].cost).toMatchObject({ status: "PRICED", lineTotal: 1_260_000 });
  });
});

describe("analyzeProject with review gaps", () => {
  it("blocks while a lab report is not fully reviewed and puts that issue first", () => {
    const pending: LabDocumentState = { id: "doc-lab-x", fileName: "LAB-X.pdf", labReportId: "LAB-X", status: "NEEDS_REVIEW", pendingRows: 2 };
    const analysis = analyzeProject(input({ documents: [...DOCUMENTS, pending] }));
    expect(analysis.issues[0]).toMatchObject({ key: "LAB_REPORT_NOT_REVIEWED:doc-lab-x", state: "OPEN" });
    expect(analysis.readiness.status).toBe("BLOCKED");
  });

  it("blocks on an accepted row whose evidence is not verified and links it to its zone", () => {
    const results = demoResults();
    const evidence = results.map((row) => ({ labResultId: row.id, evidenceVerified: row.sampleId !== "S05", confidence: "HIGH" as const, flags: [] }));
    const analysis = analyzeProject(input({ results, evidence }));
    const found = analysis.issues.find((item) => item.type === "EVIDENCE_NOT_VERIFIED");
    expect(found).toMatchObject({ severity: "blocking", state: "OPEN", refs: { zoneIds: ["zone-m05"] } });
    expect(analysis.zones[4].issueKeys).toContain(found?.key);
  });
});
