import type { ReportModel } from "./reportModel";

/**
 * The facts the AI drafts the narrative from: a projection of the ReportModel. It carries no money amount, no person's
 * name and no earlier narrative, so the AI cannot copy an amount into the prose and the guardrails can treat every
 * number outside these facts as unsupported (D-033). Pure; the server hashes the JSON to detect an outdated draft.
 */
export type NarrativeFacts = {
  project: { code: string; building: string; scope: string; plannedWork: string; employeeLimitations: string };
  counts: {
    zones: number;
    samples: number;
    layerResults: number;
    detectedZones: number;
    notDetectedZones: number;
    unresolvedZones: number;
    pricedZones: number;
  };
  zones: {
    materialId: string;
    description: string;
    floor: string;
    location: string;
    condition: string;
    quantity: string;
    plannedDisturbance: boolean;
    accessible: boolean;
    employeeNotes: string;
    status: string;
    category: string;
    categoryTitle: string;
    categoryReason: string;
    costStatus: string;
    sampleCount: number;
    samples: {
      sampleId: string;
      layers: { layer: string; result: string; asbestosType: string | null; content: string | null; sources: { labReportId: string; page: number; labNote: string | null }[] }[];
    }[];
    missingInformation: string[];
  }[];
  limitations: string[];
};

const COST_STATUS: Record<ReportModel["findings"][number]["cost"]["status"], string> = {
  PRICED: "Priced in the illustrative cost scenario (amounts are added by the application)",
  NOT_PRICED: "Not priced",
  NO_COST: "No asbestos-specific cost (not detected in the sampled material)",
};

export function narrativeFacts(model: ReportModel): NarrativeFacts {
  const { project } = model.projectInformation;
  const { counts } = model.executiveSummary;
  return {
    project: {
      code: project.code,
      building: project.building,
      scope: project.scope,
      plannedWork: project.plannedWork,
      employeeLimitations: project.limitations,
    },
    counts: {
      zones: counts.zones,
      samples: counts.samples,
      layerResults: counts.layerResults,
      detectedZones: counts.detectedZones,
      notDetectedZones: counts.notDetectedZones,
      unresolvedZones: counts.unresolvedZones,
      pricedZones: counts.pricedZones,
    },
    zones: model.findings.map((finding) => ({
      materialId: finding.materialId,
      description: finding.description,
      floor: finding.floor,
      location: finding.location,
      condition: finding.fieldEvidence.condition,
      quantity: finding.fieldEvidence.quantityText,
      plannedDisturbance: finding.fieldEvidence.plannedDisturbance,
      accessible: finding.fieldEvidence.accessible,
      employeeNotes: finding.fieldEvidence.notes,
      status: finding.interpretation,
      category: finding.category,
      categoryTitle: finding.categoryTitle,
      categoryReason: finding.reasonText,
      // NOT_PRICED texts name the reason only ("Not priced (quantity unknown)"); amounts never reach the AI.
      costStatus: finding.cost.status === "NOT_PRICED" ? finding.cost.text : COST_STATUS[finding.cost.status],
      sampleCount: finding.samples.length,
      samples: finding.samples.map((sample) => ({
        sampleId: sample.sampleId,
        layers: sample.layers.map((layer) => ({
          layer: layer.layer,
          result: layer.statusText,
          asbestosType: layer.asbestosType,
          content: layer.percentageRaw,
          sources: layer.sources.map((source) => ({ labReportId: source.labReportId, page: source.page, labNote: source.labNote })),
        })),
      })),
      missingInformation: [...finding.uncertainty],
    })),
    limitations: model.scopeLimitations.items.map((item) => item.text),
  };
}

/** Canonical JSON of the facts: objects are built in a fixed key order, so equal facts give equal text. */
export function narrativeFactsJson(facts: NarrativeFacts): string {
  return JSON.stringify(facts);
}
