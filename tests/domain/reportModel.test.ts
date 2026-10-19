import { describe, expect, it } from "vitest";
import { analyzeProject } from "@/domain/analysis";
import { formatCad } from "@/domain/format";
import { refsKey, type StoredResolution } from "@/domain/issueResolution";
import type { StoredNarrative } from "@/domain/narrative";
import { buildReportModel, type ReportInput } from "@/domain/reportModel";
import { DISCLAIMERS, REPORT_STATUS } from "@/domain/reportText";
import type { AcceptedLabResult, MaterialZone } from "@/domain/types";
import {
  byMaterial,
  demoAnalysis,
  demoAnalysisInput,
  demoReportDocuments,
  demoReportProject,
  demoResults,
  demoZones,
  labRow,
} from "../fixtures/demoProject";

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    project: demoReportProject(),
    analysis: demoAnalysis(),
    labDocuments: demoReportDocuments(),
    narrative: [],
    corrections: [],
    checklist: null,
    ...overrides,
  };
}

describe("buildReportModel on the supplied demo data", () => {
  const model = buildReportModel(input());

  it("has a findings record and a recommendation for every zone, in register order", () => {
    const order = ["M01", "M02", "M03", "M04", "M05", "M06", "M07"];
    expect(model.findings.map((finding) => finding.materialId)).toEqual(order);
    expect(model.recommendations.map((item) => item.materialId)).toEqual(order);
    expect(model.findings.map((finding) => [finding.materialId, finding.interpretation, finding.category])).toEqual([
      ["M01", "Detected", "A"],
      ["M02", "Detected", "A"],
      ["M03", "Detected", "A"],
      ["M04", "Not detected in the sampled material", "D"],
      ["M05", "Detected", "B"],
      ["M06", "Inconclusive (unresolved)", "C"],
      ["M07", "Inaccessible and unsampled (unresolved)", "C"],
    ]);
  });

  it("keeps both S02 layers with their lab source: report ID, file, page and quote", () => {
    const m02 = byMaterial(model.findings, "M02");
    expect(m02.samples).toHaveLength(1);
    const [tile, adhesive] = m02.samples[0].layers;
    expect([tile.layer, tile.statusText, adhesive.layer, adhesive.statusText]).toEqual(["Floor tile", "Not detected", "Black adhesive", "Detected"]);
    expect(adhesive.sources).toEqual([
      expect.objectContaining({
        labReportId: "LAB-A",
        fileName: "LAB-A_fictional_lab_report.pdf",
        page: 1,
        quote: "S02 Black adhesive Detected Chrysotile 2%",
        resultLabel: "DETECTED",
      }),
    ]);
    expect([adhesive.asbestosType, adhesive.percentageRaw]).toEqual(["Chrysotile", "2%"]);
  });

  it("lists S03 and S07 under M03 with one cost line for its single 140 m2", () => {
    const m03 = byMaterial(model.findings, "M03");
    expect(m03.samples.map((sample) => sample.sampleId)).toEqual(["S03", "S07"]);
    expect(m03.fieldEvidence.quantityText).toBe("140 m2");
    expect(m03.cost).toEqual({ status: "PRICED", text: "CAD 12,600.00", lineTotal: 1_260_000 });
    const lines = model.costScenario.lines.filter((line) => line.materialId === "M03");
    expect(lines).toHaveLength(1);
    expect([lines[0].quantity, lines[0].removalAmount, lines[0].replacementAmount, lines[0].lineTotal]).toEqual([140, 840_000, 420_000, 1_260_000]);
  });

  it("shows M05 as detected but Not priced, never with a zero quantity", () => {
    const m05 = byMaterial(model.findings, "M05");
    expect(m05.fieldEvidence.quantity).toBeNull();
    expect(m05.fieldEvidence.quantityText).toBe("Unknown");
    expect(m05.cost).toEqual({ status: "NOT_PRICED", text: "Not priced (quantity unknown)", lineTotal: null });
    const line = byMaterial(model.costScenario.lines, "M05");
    expect([line.priced, line.lineTotal, line.notPricedText]).toEqual([false, null, "Not priced (quantity unknown)"]);
  });

  it("has no cost line for M04 and records its limited scope", () => {
    expect(model.costScenario.lines.map((line) => line.materialId)).toEqual(["M01", "M02", "M03", "M05"]);
    const m04 = byMaterial(model.findings, "M04");
    expect(m04.cost.status).toBe("NO_COST");
    expect(m04.uncertainty).toContain("The not detected result applies only to the sampled material.");
    expect(model.scopeLimitations.items).toContainEqual(
      expect.objectContaining({ kind: "NOT_DETECTED_SCOPE", materialId: "M04", text: "M04 Wall plaster (G03 meeting room): not detected applies only to the sampled material (S04)." }),
    );
  });

  it("lists M06 and M07 in the scope limitations and in the exclusions", () => {
    const limitations = (materialId: string) => model.scopeLimitations.items.filter((item) => item.materialId === materialId).map((item) => item.kind);
    expect(limitations("M06")).toEqual(["INCONCLUSIVE"]);
    expect(limitations("M07")).toEqual(["INACCESSIBLE", "MISSING_QUANTITY"]);
    const excluded = model.assumptionsAndExclusions.exclusions.filter((exclusion) => exclusion.materialId !== null);
    expect(excluded.map((exclusion) => [exclusion.materialId, exclusion.reason])).toEqual([
      ["M05", "MISSING_QUANTITY"],
      ["M06", "UNRESOLVED"],
      ["M07", "UNRESOLVED"],
    ]);
    expect(model.assumptionsAndExclusions.exclusions.filter((exclusion) => exclusion.reason === "FIXED").map((exclusion) => exclusion.text)).toEqual([
      "Taxes",
      "Unmeasured materials",
      "Unresolved materials",
      "Hidden materials",
      "Business interruption",
      "Engineering design",
      "Permit costs",
    ]);
  });

  it("carries the golden cost summary", () => {
    const { summary } = model.costScenario;
    expect(
      [summary.removalSubtotal, summary.replacementSubtotal, summary.zoneSubtotal, summary.mobilization, summary.assessment, summary.direct, summary.contingency, summary.total].map(
        formatCad,
      ),
    ).toEqual(["15,330.00", "8,310.00", "23,640.00", "2,500.00", "1,200.00", "27,340.00", "5,468.00", "32,808.00"]);
    expect([summary.contingencyPercent, summary.pricedZones]).toEqual([20, 3]);
  });

  it("counts zones and samples separately", () => {
    expect(model.executiveSummary.counts).toEqual({
      zones: 7,
      samples: 7,
      layerResults: 8,
      detectedZones: 4,
      notDetectedZones: 1,
      unresolvedZones: 2,
      pricedZones: 3,
      byCategory: { A: 3, B: 1, C: 2, D: 1 },
    });
  });

  it("writes the executive summary amounts paragraph in code", () => {
    expect(model.executiveSummary.factsParagraph).toBe(
      "This draft covers 7 material zones with 7 registered samples and 8 laboratory layer results. " +
        "Asbestos was detected in 4 zones (M01, M02, M03, M05) and not detected in the sampled material of 1 zone (M04). " +
        "2 zones remain unresolved (M06, M07). " +
        "The illustrative cost scenario prices 3 zones: measured zone subtotal CAD 23,640.00, direct subtotal CAD 27,340.00 including mobilization and the professional assessment allowance, contingency at 20 percent CAD 5,468.00, illustrative total before tax CAD 32,808.00. " +
        "Detected but not priced: M05 Cement panel (quantity not measured). " +
        "Unresolved and not priced: M06 Insulation fragment (inconclusive lab result); M07 Uninspected riser material (inaccessible and not sampled). " +
        "Fictional exercise prices are not quotations.",
    );
  });

  it("is always a draft pending review, with the master's disclaimers", () => {
    expect(model.status).toBe(REPORT_STATUS);
    expect(model.projectInformation.rows.at(-1)).toEqual({ field: "Status", value: "Draft pending human and professional review" });
    expect(model.employeeReview.statusLine).toBe(
      "Draft pending human and professional review. Checked: none yet. Not yet checked: Sample matching, Layers, Quantities, Costs and Narrative. Reviewer: pending.",
    );
    expect(model.scopeLimitations.standing).toEqual([DISCLAIMERS.sampledMaterialOnly, DISCLAIMERS.noAirOrClearanceData, DISCLAIMERS.noComplianceOrClearance]);
    expect(model.disclaimers).toContain(DISCLAIMERS.notAQuotation);
    expect(model.employeeReview.finalNote).toBe(DISCLAIMERS.professionalValidation);
    expect(model.appendices.plan).toBeNull();
  });

  it("fills the project information rows of the master", () => {
    expect(model.projectInformation.rows.map((row) => row.field)).toEqual([
      "Project and client",
      "Building and address",
      "Inspection and report dates",
      "Employee and reviewer",
      "Scope and planned work",
      "Status",
    ]);
    expect(byField(model, "Employee and reviewer")).toBe("Prepared by not entered · Reviewed by pending");
    expect(byField(model, "Inspection and report dates")).toBe("Inspection 2026-10-01 · Report not entered");
  });

  it("lists the sample register and the lab sources with their quotes", () => {
    expect(model.appendices.sampleRegister.map((row) => [row.sampleId, row.materialId, row.status, row.layerResults, row.labReportIds])).toEqual([
      ["S01", "M01", "DETECTED", 1, ["LAB-A"]],
      ["S02", "M02", "DETECTED", 2, ["LAB-A"]],
      ["S03", "M03", "DETECTED", 1, ["LAB-A"]],
      ["S07", "M03", "DETECTED", 1, ["LAB-C"]],
      ["S04", "M04", "NOT_DETECTED", 1, ["LAB-B"]],
      ["S05", "M05", "DETECTED", 1, ["LAB-B"]],
      ["S06", "M06", "INCONCLUSIVE", 1, ["LAB-B"]],
    ]);
    expect(model.appendices.labSources.map((document) => [document.labReportId, document.status, document.rows.length])).toEqual([
      ["LAB-A", "ACCEPTED", 4],
      ["LAB-B", "ACCEPTED", 3],
      ["LAB-C", "ACCEPTED", 1],
    ]);
    expect(model.appendices.labSources[2].rows[0]).toMatchObject({ sampleId: "S07", page: 1, quote: "S07 Textured coating Detected Chrysotile 1%" });
  });

  it("is deterministic and leaves its input unchanged", () => {
    const first = input();
    const snapshot = structuredClone(first);
    expect(buildReportModel(first)).toEqual(buildReportModel(input()));
    expect(first).toEqual(snapshot);
  });
});

const byField = (model: ReturnType<typeof buildReportModel>, field: string) =>
  model.projectInformation.rows.find((row) => row.field === field)?.value;

describe("buildReportModel narrative, checklist and appendices", () => {
  it("shows each narrative slot as AI draft, edited or not drafted", () => {
    const narrative: StoredNarrative[] = [
      { section: "executiveSummary", itemKey: "", aiText: "AI summary", text: "AI summary", source: "AI_DRAFT" },
      { section: "recommendation", itemKey: "zone-m01", aiText: "AI text", text: "Employee text", source: "EDITED" },
    ];
    const model = buildReportModel(input({ narrative }));
    expect(model.executiveSummary.narrative).toEqual({ section: "executiveSummary", itemKey: "", text: "AI summary", aiText: "AI summary", source: "AI_DRAFT" });
    expect(byMaterial(model.recommendations, "M01").narrative).toMatchObject({ text: "Employee text", aiText: "AI text", source: "EDITED" });
    expect(byMaterial(model.findings, "M01").narrative.interpretation).toEqual({ section: "zoneInterpretation", itemKey: "zone-m01", text: "", aiText: null, source: "NONE" });
  });

  it("states which review items are checked and who reviewed", () => {
    const model = buildReportModel(
      input({
        checklist: {
          samplesChecked: true,
          layersChecked: true,
          quantitiesChecked: false,
          costsChecked: false,
          narrativeChecked: false,
          reviewerName: "A. Reviewer",
          reviewedOn: "2026-10-19",
        },
      }),
    );
    expect(model.employeeReview.statusLine).toBe(
      "Draft pending human and professional review. Checked: Sample matching and Layers. Not yet checked: Quantities, Costs and Narrative. Reviewer: A. Reviewer, 2026-10-19.",
    );
    expect(model.employeeReview.checklist.map((item) => [item.label, item.checked])).toEqual([
      ["Sample matching checked", true],
      ["Layers checked", true],
      ["Quantities checked", false],
      ["Costs checked", false],
      ["Narrative checked", false],
    ]);
    expect(model.status).toBe(REPORT_STATUS);
  });

  it("lists corrections in time order with readable values", () => {
    const model = buildReportModel(
      input({
        corrections: [
          {
            id: "c2",
            subject: { kind: "LAB_REPORT", fileName: "LAB-B_fictional_lab_report.pdf" },
            field: "labReportId",
            oldValue: null,
            newValue: "LAB-B",
            reason: "ID printed in the title",
            createdAt: "2026-10-19T10:00:00.000Z",
          },
          {
            id: "c1",
            subject: { kind: "LAB_ROW", sampleId: "S02", layer: "Black adhesive", labReportId: "LAB-A", page: 1 },
            field: "resultLabel",
            oldValue: "NOT_DETECTED",
            newValue: "DETECTED",
            reason: "Misread by the AI",
            createdAt: "2026-10-19T09:00:00.000Z",
          },
        ],
      }),
    );
    expect(model.appendices.corrections.map(({ target, field, from, to, reason }) => [target, field, from, to, reason])).toEqual([
      ["S02 · Black adhesive · LAB-A p.1", "Result", "Not detected", "Detected", "Misread by the AI"],
      ["Lab report file LAB-B_fictional_lab_report.pdf", "Lab report ID", "(empty)", "LAB-B", "ID printed in the title"],
    ]);
  });

  it("carries a flagged issue into the limitations and an unmatched lab sample into the register", () => {
    const labX: AcceptedLabResult = labRow({ labReportId: "LAB-X", sampleId: "S7", layer: "Textured coating", resultLabel: "DETECTED" });
    const documents = [
      ...demoAnalysisInput().documents,
      { id: "doc-lab-x", fileName: "LAB-X_test_report.pdf", labReportId: "LAB-X", status: "ACCEPTED" as const, pendingRows: 0 },
    ];
    const results = [...demoResults(), labX];
    const open = analyzeProject(demoAnalysisInput({ results, documents }));
    const unmatched = open.issues.find((found) => found.type === "UNMATCHED_LAB_SAMPLE");
    if (unmatched === undefined) throw new Error("expected the unmatched S7 issue");
    const resolution: StoredResolution = {
      issueKey: unmatched.key,
      issueType: unmatched.type,
      issueMessage: unmatched.message,
      refsKey: refsKey(unmatched.refs),
      decision: "FLAGGED",
      note: "S7 is probably S07; kept visible until the lab confirms.",
      decidedAt: "2026-10-19T10:00:00.000Z",
    };
    const analysis = analyzeProject(demoAnalysisInput({ results, documents, resolutions: [resolution] }));
    const model = buildReportModel(input({ analysis }));

    expect(model.scopeLimitations.items).toContainEqual(
      expect.objectContaining({ kind: "FLAGGED_ISSUE", text: expect.stringContaining("Employee note: S7 is probably S07; kept visible until the lab confirms.") }),
    );
    expect(model.appendices.sampleRegister.at(-1)).toEqual({ sampleId: "S7", materialId: null, location: null, status: "UNMATCHED", layerResults: 1, labReportIds: ["LAB-X"] });
    expect(model.appendices.decisions).toEqual([expect.objectContaining({ issueKey: unmatched.key, decision: "FLAGGED", state: "CURRENT" })]);
    expect(model.employeeReview.readiness.status).toBe("DRAFT_WITH_FLAGS");
  });
});

describe("buildReportModel cost paragraph", () => {
  it("follows the brief's arithmetic example: 10 m2 x (50 + 20)", () => {
    const zone: MaterialZone = {
      ...demoZones()[0],
      id: "zone-example",
      materialId: "X01",
      description: "Example board",
      location: "Example room",
      sampleIds: ["T01"],
      quantity: 10,
      unit: "m2",
      rateRef: "R_EXAMPLE",
      condition: "intact",
    };
    const row = labRow({ labReportId: "LAB-T", sampleId: "T01", layer: "Board", resultLabel: "DETECTED" });
    const analysis = analyzeProject({
      zones: [zone],
      results: [row],
      evidence: [{ labResultId: row.id, evidenceVerified: true, confidence: "HIGH", flags: [] }],
      documents: [{ id: row.documentId, fileName: row.fileName, labReportId: "LAB-T", status: "ACCEPTED", pendingRows: 0 }],
      resolutions: [],
      rateCard: { R_EXAMPLE: { ref: "R_EXAMPLE", material: "Example", unit: "m2", removalRate: 5_000, replacementRate: 2_000 } },
    });
    const model = buildReportModel(input({ analysis, labDocuments: [] }));
    expect(model.costScenario.lines[0].lineTotal).toBe(70_000);
    expect(model.executiveSummary.factsParagraph).toContain(
      "prices 1 zone: measured zone subtotal CAD 700.00, direct subtotal CAD 4,400.00 including mobilization and the professional assessment allowance, contingency at 20 percent CAD 880.00, illustrative total before tax CAD 5,280.00.",
    );
  });

  it("says that nothing is priced when no zone is detected", () => {
    const results = demoResults().map((row) => ({ ...row, resultLabel: "NOT_DETECTED" as const }));
    const model = buildReportModel(input({ analysis: demoAnalysis({ results }) }));
    expect(model.executiveSummary.factsParagraph).toContain("The illustrative cost scenario prices no zone, so no allowance or contingency is added.");
    expect(model.executiveSummary.factsParagraph).not.toContain("Detected but not priced");
    expect(model.costScenario.summary.total).toBe(0);
  });
});
