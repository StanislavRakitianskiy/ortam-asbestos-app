/**
 * TEST FIXTURE. The supplied demo project typed by hand from fixtures/employee_field_notes.pdf and the
 * LAB-A/B/C PDFs. Lab results may appear only in tests and test fixtures, never in application code.
 */
import { analyzeProject, type AnalysisInput, type ProjectAnalysis } from "@/domain/analysis";
import { formatResultLabel } from "@/domain/format";
import type { LabDocumentState } from "@/domain/labRowIssues";
import type { ReportLabDocument, ReportProject } from "@/domain/reportModel";
import type { AcceptedLabResult, MaterialZone } from "@/domain/types";

/** Fresh copies on every call, so a test can change a zone without affecting others. */
export function demoZones(): MaterialZone[] {
  return [
    {
      id: "zone-m01",
      materialId: "M01",
      description: "Pipe insulation",
      floor: "Basement",
      location: "B01 mechanical room",
      sampleIds: ["S01"],
      quantity: 24,
      unit: "linear_m",
      condition: "poor",
      plannedDisturbance: false,
      rateRef: "R_PIPE",
      accessible: true,
      notes: "Visible damage recorded; quantity is an exercise input.",
    },
    {
      id: "zone-m02",
      materialId: "M02",
      description: "Floor tile and adhesive",
      floor: "Ground",
      location: "G01 corridor",
      sampleIds: ["S02"],
      quantity: 90,
      unit: "m2",
      condition: "intact",
      plannedDisturbance: true,
      rateRef: "R_FLOOR",
      accessible: true,
      notes: "Tile and underlying adhesive are distinct lab layers.",
    },
    {
      id: "zone-m03",
      materialId: "M03",
      description: "Textured ceiling",
      floor: "Ground",
      location: "G02 office",
      sampleIds: ["S03", "S07"],
      quantity: 140,
      unit: "m2",
      condition: "damaged",
      plannedDisturbance: true,
      rateRef: "R_CEILING",
      accessible: true,
      notes: "Two samples represent one material zone; count 140 m2 only once.",
    },
    {
      id: "zone-m04",
      materialId: "M04",
      description: "Wall plaster",
      floor: "Ground",
      location: "G03 meeting room",
      sampleIds: ["S04"],
      quantity: 65,
      unit: "m2",
      condition: "intact",
      plannedDisturbance: false,
      rateRef: null,
      accessible: true,
      notes: "Result applies only to sampled material.",
    },
    {
      id: "zone-m05",
      materialId: "M05",
      description: "Cement panel",
      floor: "Exterior",
      location: "E01 east elevation",
      sampleIds: ["S05"],
      quantity: null,
      unit: "m2",
      condition: "intact",
      plannedDisturbance: false,
      rateRef: "R_PANEL",
      accessible: true,
      notes: "Quantity not measured. Do not treat blank as zero.",
    },
    {
      id: "zone-m06",
      materialId: "M06",
      description: "Insulation fragment",
      floor: "Basement",
      location: "B02 service room",
      sampleIds: ["S06"],
      quantity: 8,
      unit: "m2",
      condition: "unknown",
      plannedDisturbance: false,
      rateRef: null,
      accessible: true,
      notes: "Inconclusive laboratory result; do not classify as negative.",
    },
    {
      id: "zone-m07",
      materialId: "M07",
      description: "Uninspected riser material",
      floor: "Basement",
      location: "B03 locked riser",
      sampleIds: [],
      quantity: null,
      unit: "m2",
      condition: "unknown",
      plannedDisturbance: false,
      rateRef: null,
      accessible: false,
      notes: "No access and no sample. No conclusion about asbestos presence.",
    },
  ];
}

const SUPPLIED_FILES: Record<string, { documentId: string; fileName: string }> = {
  "LAB-A": { documentId: "doc-lab-a", fileName: "LAB-A_fictional_lab_report.pdf" },
  "LAB-B": { documentId: "doc-lab-b", fileName: "LAB-B_fictional_lab_report.pdf" },
  "LAB-C": { documentId: "doc-lab-c", fileName: "LAB-C_fictional_lab_report.pdf" },
};

type LabRowInput = Pick<AcceptedLabResult, "labReportId" | "sampleId" | "layer" | "resultLabel"> &
  Partial<AcceptedLabResult>;

/** Builds one accepted lab row; unknown report IDs get a made-up test document. */
export function labRow(fields: LabRowInput): AcceptedLabResult {
  const file = SUPPLIED_FILES[fields.labReportId] ?? {
    documentId: `doc-${fields.labReportId.toLowerCase()}`,
    fileName: `${fields.labReportId}_test_report.pdf`,
  };
  return {
    id: `${fields.labReportId}-${fields.sampleId.trim()}-${fields.layer.trim()}`.toLowerCase().replace(/\s+/g, "-"),
    ...file,
    page: 1,
    sourceText: `${fields.sampleId} ${fields.layer} ${formatResultLabel(fields.resultLabel)}`,
    asbestosType: null,
    percentage: null,
    percentageRaw: null,
    labNote: null,
    ...fields,
  };
}

const S02_NOTE = "S02 has two separately reported layers. A tile result must not overwrite the adhesive result.";

export function demoResults(): AcceptedLabResult[] {
  return [
    labRow({
      labReportId: "LAB-A",
      sampleId: "S01",
      layer: "Insulation",
      resultLabel: "DETECTED",
      asbestosType: "Chrysotile",
      percentage: 15,
      percentageRaw: "15%",
      sourceText: "S01 Insulation Detected Chrysotile 15%",
    }),
    labRow({
      labReportId: "LAB-A",
      sampleId: "S02",
      layer: "Floor tile",
      resultLabel: "NOT_DETECTED",
      percentageRaw: "Not reported",
      sourceText: "S02 Floor tile Not detected Not reported Not reported",
      labNote: S02_NOTE,
    }),
    labRow({
      labReportId: "LAB-A",
      sampleId: "S02",
      layer: "Black adhesive",
      resultLabel: "DETECTED",
      asbestosType: "Chrysotile",
      percentage: 2,
      percentageRaw: "2%",
      sourceText: "S02 Black adhesive Detected Chrysotile 2%",
      labNote: S02_NOTE,
    }),
    labRow({
      labReportId: "LAB-A",
      sampleId: "S03",
      layer: "Textured coating",
      resultLabel: "DETECTED",
      asbestosType: "Chrysotile",
      percentage: 1,
      percentageRaw: "1%",
      sourceText: "S03 Textured coating Detected Chrysotile 1%",
    }),
    labRow({
      labReportId: "LAB-B",
      sampleId: "S04",
      layer: "Plaster",
      resultLabel: "NOT_DETECTED",
      percentageRaw: "Not reported",
      sourceText: "S04 Plaster Not detected Not reported Not reported",
    }),
    labRow({
      labReportId: "LAB-B",
      sampleId: "S05",
      layer: "Cement panel",
      resultLabel: "DETECTED",
      asbestosType: "Chrysotile",
      percentage: 8,
      percentageRaw: "8%",
      sourceText: "S05 Cement panel Detected Chrysotile 8%",
      labNote: "S05 quantity is not supplied by the lab.",
    }),
    labRow({
      labReportId: "LAB-B",
      sampleId: "S06",
      layer: "Insulation fragment",
      resultLabel: "INCONCLUSIVE",
      percentageRaw: "Not reported",
      sourceText: "S06 Insulation fragment Inconclusive Not reported Not reported",
      labNote:
        "S06: insufficient usable material. Result is inconclusive; further professional assessment is required.",
    }),
    labRow({
      labReportId: "LAB-C",
      sampleId: "S07",
      layer: "Textured coating",
      resultLabel: "DETECTED",
      asbestosType: "Chrysotile",
      percentage: 1,
      percentageRaw: "1%",
      sourceText: "S07 Textured coating Detected Chrysotile 1%",
      labNote:
        "S07 is a second representative sample of the M03 ceiling zone also sampled as S03. This does not create an additional quantity.",
    }),
  ];
}

/** Returns the zones with one zone changed. Throws if the material ID is not in the list. */
export function withZone(
  zones: MaterialZone[],
  materialId: string,
  patch: Partial<MaterialZone>,
): MaterialZone[] {
  if (!zones.some((zone) => zone.materialId === materialId)) throw new Error(`No zone ${materialId} in fixture`);
  return zones.map((zone) => (zone.materialId === materialId ? { ...zone, ...patch } : zone));
}

/** The three supplied lab reports, fully reviewed. */
export function demoDocuments(): LabDocumentState[] {
  return ["LAB-A", "LAB-B", "LAB-C"].map((id) => ({
    id: `doc-${id.toLowerCase()}`,
    fileName: `${id}_fictional_lab_report.pdf`,
    labReportId: id,
    status: "ACCEPTED",
    pendingRows: 0,
  }));
}

/** Analysis input for the demo: every row accepted with verified evidence, no decisions. */
export function demoAnalysisInput(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  const results = overrides.results ?? demoResults();
  return {
    zones: demoZones(),
    results,
    evidence: results.map((row) => ({ labResultId: row.id, evidenceVerified: true, confidence: "HIGH", flags: [] })),
    documents: demoDocuments(),
    resolutions: [],
    ...overrides,
  };
}

export function demoAnalysis(overrides: Partial<AnalysisInput> = {}): ProjectAnalysis {
  return analyzeProject(demoAnalysisInput(overrides));
}

/** Project information from fixtures/employee_field_notes.pdf (as in the dev seed). */
export function demoReportProject(): ReportProject {
  return {
    code: "ORTAM-DEMO-001",
    client: "Example Property Group fictional",
    building: "Fictional Training Building A",
    address: "Training Site A - no real address",
    inspectionDate: "2026-10-01",
    reportDate: null,
    preparedBy: "",
    reviewedBy: null,
    scope: "Accessible areas only; illustration for hiring assessment",
    plannedWork: "Ground corridor floor and office ceiling replacement planned",
    limitations: "",
    jurisdictionNote: "Unspecified - no regulatory compliance conclusion permitted",
    currency: "CAD",
  };
}

export function demoReportDocuments(): ReportLabDocument[] {
  return demoDocuments().map((document, index) => ({
    id: document.id,
    fileName: document.fileName,
    labReportId: document.labReportId,
    labName: "Fictional laboratory",
    issuedDate: null,
    sha256: `${index}`.repeat(64),
    pageCount: 1,
  }));
}

export function byMaterial<T extends { materialId: string | null }>(items: readonly T[], materialId: string): T {
  const found = items.find((item) => item.materialId === materialId);
  if (found === undefined) throw new Error(`No item for ${materialId}`);
  return found;
}
