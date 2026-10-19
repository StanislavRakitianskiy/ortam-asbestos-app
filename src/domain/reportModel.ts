import type { ProjectAnalysis, ZoneAnalysis, ZoneCost } from "./analysis";
import { CATEGORY_TITLES, type CategoryReasonCode } from "./categories";
import { UNRESOLVED_TEXT, type ExclusionReason, type NotPricedReason } from "./costs";
import { formatCad, formatQuantity, formatResultLabel } from "./format";
import type { IssueView, Readiness } from "./issueResolution";
import type { LayerStatus, SampleMatch, SampleStatus } from "./matching";
import { narrativeBlock, type NarrativeBlock, type StoredNarrative } from "./narrative";
import { CONTINGENCY_PERCENT } from "./rates";
import {
  COST_ASSUMPTIONS,
  COST_SCENARIO_TEXT,
  DISCLAIMERS,
  FICTIONAL_NOTICE,
  HIDDEN_MATERIALS_LIMITATION,
  REPORT_STATUS,
  factsParagraph,
  joinAnd,
  type ReportCounts,
  type ZoneMention,
} from "./reportText";
import { CHECKLIST_ITEMS, EMPTY_CHECKLIST, type ChecklistKey, type ReviewChecklistState } from "./reviewChecklist";
import type { Category, Cents, Condition, ResultLabel, Unit, ZoneStatus } from "./types";

/**
 * Everything the report says, in the sections of the Word master (fixtures/master_asbestos_report.docx). Pure and
 * deterministic: the same input gives the same model. Facts, categories and amounts come from the analysis; the AI
 * only supplies the narrative blocks, which are shown as drafts.
 */

// ---------------------------------------------------------------- input

export type ReportProject = {
  code: string;
  client: string;
  building: string;
  address: string;
  inspectionDate: string | null;
  reportDate: string | null;
  preparedBy: string;
  /** null while the review is pending. */
  reviewedBy: string | null;
  scope: string;
  plannedWork: string;
  limitations: string;
  jurisdictionNote: string;
  currency: string;
};

/** An uploaded lab report, for the source appendix. */
export type ReportLabDocument = {
  id: string;
  fileName: string;
  labReportId: string | null;
  labName: string | null;
  issuedDate: string | null;
  sha256: string;
  pageCount: number;
};

/** What a logged correction changed, described with the values the row has now. */
export type CorrectionSubject =
  | { kind: "LAB_ROW"; sampleId: string; layer: string; labReportId: string; page: number }
  | { kind: "LAB_REPORT"; fileName: string }
  | { kind: "UNKNOWN"; entity: string };

export type ReportCorrection = {
  id: string;
  subject: CorrectionSubject;
  field: string;
  /** Decoded from the stored JSON; null when absent. */
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  /** ISO timestamp. */
  createdAt: string;
};

export type ReportInput = {
  project: ReportProject;
  analysis: ProjectAnalysis;
  /** Every uploaded lab report of the project, in upload order. */
  labDocuments: readonly ReportLabDocument[];
  narrative: readonly StoredNarrative[];
  corrections: readonly ReportCorrection[];
  /** null when the employee has not saved the checklist yet. */
  checklist: ReviewChecklistState | null;
};

// ---------------------------------------------------------------- output

export type InfoRow = { field: string; value: string };

export type LayerSource = {
  labResultId: string;
  labReportId: string;
  fileName: string;
  page: number;
  quote: string;
  resultLabel: ResultLabel;
  asbestosType: string | null;
  percentageRaw: string | null;
  labNote: string | null;
};

export type FindingLayer = {
  layer: string;
  status: LayerStatus;
  statusText: string;
  asbestosType: string | null;
  percentage: number | null;
  percentageRaw: string | null;
  /** Every counted lab row behind the layer. A conflicting layer has rows with different results. */
  sources: LayerSource[];
};

export type FindingSample = { sampleId: string; status: SampleStatus; layers: FindingLayer[] };

export type ZoneCostView = { status: ZoneCost["status"]; text: string; lineTotal: Cents | null };

export type ZoneFinding = {
  zoneId: string;
  materialId: string;
  description: string;
  floor: string;
  location: string;
  fieldEvidence: {
    condition: Condition;
    quantity: number | null;
    unit: Unit;
    quantityText: string;
    plannedDisturbance: boolean;
    accessible: boolean;
    notes: string;
  };
  samples: FindingSample[];
  zoneStatus: ZoneStatus;
  /** Detected / not detected in the sampled material / inconclusive / unsampled … */
  interpretation: string;
  category: Category;
  categoryTitle: string;
  reasonCodes: CategoryReasonCode[];
  /** Built in code by categorize(). */
  reasonText: string;
  cost: ZoneCostView;
  /** Missing information, built in code. Empty when nothing is missing. */
  uncertainty: string[];
  narrative: { interpretation: NarrativeBlock; reason: NarrativeBlock; uncertainty: NarrativeBlock; followUp: NarrativeBlock };
};

export type ZoneRecommendation = {
  zoneId: string;
  materialId: string;
  description: string;
  location: string;
  sampleIds: string[];
  category: Category;
  categoryTitle: string;
  narrative: NarrativeBlock;
};

export type LimitationKind =
  | "INACCESSIBLE"
  | "UNSAMPLED"
  | "INCONCLUSIVE"
  | "CONFLICT"
  | "AWAITING_RESULT"
  | "MISSING_QUANTITY"
  | "NOT_PRICED"
  | "NOT_DETECTED_SCOPE"
  | "FLAGGED_ISSUE"
  | "HIDDEN_MATERIALS";

export type LimitationItem = { kind: LimitationKind; zoneId: string | null; materialId: string | null; text: string };

export type CostRow = {
  zoneId: string;
  materialId: string;
  description: string;
  quantity: number | null;
  unit: Unit;
  quantityText: string;
  rateRef: string | null;
  removalRate: Cents | null;
  replacementRate: Cents | null;
  removalAmount: Cents | null;
  replacementAmount: Cents | null;
  lineTotal: Cents | null;
  priced: boolean;
  /** "Not priced (quantity unknown)"; null for a priced line. */
  notPricedText: string | null;
};

export type CostSummary = {
  removalSubtotal: Cents;
  replacementSubtotal: Cents;
  zoneSubtotal: Cents;
  mobilization: Cents;
  assessment: Cents;
  direct: Cents;
  contingency: Cents;
  total: Cents;
  contingencyPercent: number;
  pricedZones: number;
};

export type ExclusionItem = { reason: ExclusionReason; materialId: string | null; text: string };

export type ChecklistItemView = { key: ChecklistKey; label: string; checked: boolean };

export type CorrectionEntry = {
  id: string;
  target: string;
  field: string;
  from: string;
  to: string;
  reason: string;
  createdAt: string;
};

export type DecisionEntry = {
  issueKey: string;
  issueType: string;
  message: string;
  decision: "RESOLVED" | "FLAGGED";
  note: string;
  decidedAt: string;
  /** CURRENT applies now; OUTDATED was made on other evidence; AUTO_CLEARED: the issue disappeared after a correction. */
  state: "CURRENT" | "OUTDATED" | "AUTO_CLEARED";
};

export type SampleRegisterRow = {
  sampleId: string;
  /** null for a lab sample that matches no registered sample. */
  materialId: string | null;
  location: string | null;
  status: SampleStatus | "UNMATCHED";
  layerResults: number;
  labReportIds: string[];
};

export type LabSourceRow = {
  labResultId: string;
  sampleId: string;
  layer: string;
  resultLabel: ResultLabel;
  asbestosType: string | null;
  percentageRaw: string | null;
  page: number;
  quote: string;
  labNote: string | null;
};

export type LabSourceDocument = {
  documentId: string;
  fileName: string;
  labReportId: string | null;
  labName: string | null;
  issuedDate: string | null;
  sha256: string;
  pageCount: number;
  /** Review status of the lab report; only rows of ACCEPTED reports are used. */
  status: string;
  rows: LabSourceRow[];
};

export type ReportModel = {
  notice: string;
  /** Always REPORT_STATUS. */
  status: string;
  projectInformation: { project: ReportProject; rows: InfoRow[] };
  executiveSummary: { narrative: NarrativeBlock; factsParagraph: string; counts: ReportCounts };
  findings: ZoneFinding[];
  recommendations: ZoneRecommendation[];
  scopeLimitations: { items: LimitationItem[]; projectLimitations: string; standing: string[]; narrative: NarrativeBlock };
  costScenario: { scenarioText: string; lines: CostRow[]; summary: CostSummary };
  assumptionsAndExclusions: { assumptions: string[]; exclusions: ExclusionItem[] };
  employeeReview: {
    checklist: ChecklistItemView[];
    reviewerName: string | null;
    reviewedOn: string | null;
    statusLine: string;
    readiness: Readiness;
    finalNote: string;
  };
  appendices: {
    corrections: CorrectionEntry[];
    decisions: DecisionEntry[];
    sampleRegister: SampleRegisterRow[];
    labSources: LabSourceDocument[];
    /** Floor plan appendix: not implemented yet. */
    plan: null;
  };
  disclaimers: string[];
};

// ---------------------------------------------------------------- wording

const INTERPRETATION: Record<ZoneStatus, string> = {
  DETECTED: "Detected",
  NOT_DETECTED: "Not detected in the sampled material",
  INCONCLUSIVE: "Inconclusive (unresolved)",
  CONFLICT: "Conflicting lab results (unresolved)",
  AWAITING_RESULT: "Awaiting lab result (unresolved)",
  UNSAMPLED: "Unsampled (unresolved)",
  INACCESSIBLE: "Inaccessible and unsampled (unresolved)",
};

const LAYER_STATUS_TEXT: Record<LayerStatus, string> = {
  DETECTED: "Detected",
  NOT_DETECTED: "Not detected",
  INCONCLUSIVE: "Inconclusive",
  CONFLICT: "Conflicting results",
};

/** Short reason after "Not priced (…)". */
const NOT_PRICED_SHORT: Record<NotPricedReason | "UNRESOLVED", string> = {
  MISSING_QUANTITY: "quantity unknown",
  MISSING_RATE: "no rate reference",
  UNKNOWN_RATE_REF: "rate not on the rate card",
  RATE_UNIT_MISMATCH: "rate unit does not match the zone unit",
  UNRESOLVED: "unresolved",
};

/** Detail for "Detected but not priced: M05 Cement panel (…)". */
const NOT_PRICED_DETAIL: Record<NotPricedReason, string> = {
  MISSING_QUANTITY: "quantity not measured",
  MISSING_RATE: "no rate reference assigned",
  UNKNOWN_RATE_REF: "rate reference not on the rate card",
  RATE_UNIT_MISMATCH: "rate unit does not match the zone unit",
};

const CORRECTION_FIELD_LABELS: Record<string, string> = {
  sampleId: "Sample ID",
  layer: "Layer",
  resultLabel: "Result",
  asbestosType: "Asbestos type",
  percentage: "Content %",
  labNote: "Lab note",
  row: "Row added by hand",
  labReportId: "Lab report ID",
};

const orNotEntered = (value: string | null, label = "not entered") => (value === null || value.trim() === "" ? label : value.trim());
const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
const zoneLabel = (zone: { materialId: string; description: string; location: string }) =>
  `${zone.materialId} ${zone.description} (${zone.location})`;

// ---------------------------------------------------------------- builder

export function buildReportModel(input: ReportInput): ReportModel {
  const { project, analysis } = input;
  const checklist = input.checklist ?? EMPTY_CHECKLIST;
  const counts = reportCounts(analysis);
  const block = (section: Parameters<typeof narrativeBlock>[1], itemKey: string) => narrativeBlock(input.narrative, section, itemKey);

  const findings = analysis.zones.map(
    (entry): ZoneFinding => ({
      zoneId: entry.zone.id,
      materialId: entry.zone.materialId,
      description: entry.zone.description,
      floor: entry.zone.floor,
      location: entry.zone.location,
      fieldEvidence: {
        condition: entry.zone.condition,
        quantity: entry.zone.quantity,
        unit: entry.zone.unit,
        quantityText: formatQuantity(entry.zone.quantity, entry.zone.unit),
        plannedDisturbance: entry.zone.plannedDisturbance,
        accessible: entry.zone.accessible,
        notes: entry.zone.notes,
      },
      samples: entry.samples.map(findingSample),
      zoneStatus: entry.zoneStatus,
      interpretation: INTERPRETATION[entry.zoneStatus],
      category: entry.categorization.category,
      categoryTitle: CATEGORY_TITLES[entry.categorization.category],
      reasonCodes: [...entry.categorization.reasonCodes],
      reasonText: entry.categorization.reasonText,
      cost: costView(entry.cost),
      uncertainty: zoneUncertainty(entry, analysis.issues),
      narrative: {
        interpretation: block("zoneInterpretation", entry.zone.id),
        reason: block("zoneReason", entry.zone.id),
        uncertainty: block("zoneUncertainty", entry.zone.id),
        followUp: block("zoneFollowUp", entry.zone.id),
      },
    }),
  );

  const recommendations = analysis.zones.map(
    (entry): ZoneRecommendation => ({
      zoneId: entry.zone.id,
      materialId: entry.zone.materialId,
      description: entry.zone.description,
      location: entry.zone.location,
      sampleIds: entry.samples.map((sample) => sample.sampleId),
      category: entry.categorization.category,
      categoryTitle: CATEGORY_TITLES[entry.categorization.category],
      narrative: block("recommendation", entry.zone.id),
    }),
  );

  const checklistItems = CHECKLIST_ITEMS.map((item): ChecklistItemView => ({ key: item.key, label: item.label, checked: checklist[item.key] }));

  return {
    notice: FICTIONAL_NOTICE,
    status: REPORT_STATUS,
    projectInformation: { project: { ...project }, rows: projectRows(project) },
    executiveSummary: {
      narrative: block("executiveSummary", ""),
      factsParagraph: factsParagraph(factsParagraphInput(analysis, counts)),
      counts,
    },
    findings,
    recommendations,
    scopeLimitations: {
      items: limitationItems(analysis),
      projectLimitations: project.limitations.trim(),
      standing: [DISCLAIMERS.sampledMaterialOnly, DISCLAIMERS.noAirOrClearanceData, DISCLAIMERS.noComplianceOrClearance],
      narrative: block("limitations", ""),
    },
    costScenario: {
      scenarioText: COST_SCENARIO_TEXT,
      lines: analysis.estimate.lines.map(
        (line): CostRow => ({
          zoneId: line.zoneId,
          materialId: line.materialId,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          quantityText: formatQuantity(line.quantity, line.unit),
          rateRef: line.rateRef,
          removalRate: line.removalRate,
          replacementRate: line.replacementRate,
          removalAmount: line.removalAmount,
          replacementAmount: line.replacementAmount,
          lineTotal: line.lineTotal,
          priced: line.status === "PRICED",
          notPricedText: line.status === "PRICED" ? null : `Not priced (${NOT_PRICED_SHORT[line.notPricedReason]})`,
        }),
      ),
      summary: {
        removalSubtotal: analysis.estimate.removalSubtotal,
        replacementSubtotal: analysis.estimate.replacementSubtotal,
        zoneSubtotal: analysis.estimate.zoneSubtotal,
        mobilization: analysis.estimate.mobilization,
        assessment: analysis.estimate.assessment,
        direct: analysis.estimate.direct,
        contingency: analysis.estimate.contingency,
        total: analysis.estimate.total,
        contingencyPercent: CONTINGENCY_PERCENT,
        pricedZones: counts.pricedZones,
      },
    },
    assumptionsAndExclusions: {
      assumptions: [...COST_ASSUMPTIONS],
      exclusions: analysis.estimate.exclusions.map((exclusion) => ({
        reason: exclusion.reason,
        materialId: exclusion.materialId,
        text: exclusion.reason === "FIXED" ? capitalize(exclusion.text) : exclusion.text,
      })),
    },
    employeeReview: {
      checklist: checklistItems,
      reviewerName: checklist.reviewerName,
      reviewedOn: checklist.reviewedOn,
      statusLine: statusLine(checklist),
      readiness: { ...analysis.readiness },
      finalNote: DISCLAIMERS.professionalValidation,
    },
    appendices: {
      corrections: [...input.corrections]
        .sort((first, second) => first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id))
        .map(correctionEntry),
      decisions: decisionEntries(analysis),
      sampleRegister: sampleRegister(analysis),
      labSources: labSources(input.labDocuments, analysis),
      plan: null,
    },
    disclaimers: Object.values(DISCLAIMERS),
  };
}

export function reportCounts(analysis: ProjectAnalysis): ReportCounts {
  const layersBySample = new Map<string, number>();
  for (const entry of analysis.zones) {
    for (const sample of entry.samples) layersBySample.set(sample.sampleId, sample.layers.length);
  }
  const byCategory: Record<Category, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const entry of analysis.zones) byCategory[entry.categorization.category] += 1;
  const statuses = analysis.zones.map((entry) => entry.zoneStatus);
  const detectedZones = statuses.filter((status) => status === "DETECTED").length;
  const notDetectedZones = statuses.filter((status) => status === "NOT_DETECTED").length;
  return {
    zones: analysis.zones.length,
    samples: layersBySample.size,
    layerResults: [...layersBySample.values()].reduce((total, count) => total + count, 0),
    detectedZones,
    notDetectedZones,
    unresolvedZones: statuses.length - detectedZones - notDetectedZones,
    pricedZones: analysis.estimate.lines.filter((line) => line.status === "PRICED").length,
    byCategory,
  };
}

function factsParagraphInput(analysis: ProjectAnalysis, counts: ReportCounts) {
  const withStatus = (predicate: (status: ZoneStatus) => boolean) =>
    analysis.zones.filter((entry) => predicate(entry.zoneStatus)).map((entry) => entry.zone.materialId);
  const isUnresolved = (status: ZoneStatus) => status !== "DETECTED" && status !== "NOT_DETECTED";
  return {
    counts,
    detected: withStatus((status) => status === "DETECTED"),
    notDetected: withStatus((status) => status === "NOT_DETECTED"),
    unresolved: withStatus(isUnresolved),
    totals: analysis.estimate,
    notPriced: analysis.estimate.lines.flatMap((line): ZoneMention[] =>
      line.status === "NOT_PRICED"
        ? [{ materialId: line.materialId, description: line.description, detail: NOT_PRICED_DETAIL[line.notPricedReason] }]
        : [],
    ),
    unresolvedDetails: analysis.zones.flatMap((entry): ZoneMention[] => {
      const status = entry.zoneStatus;
      if (status === "DETECTED" || status === "NOT_DETECTED") return [];
      return [{ materialId: entry.zone.materialId, description: entry.zone.description, detail: UNRESOLVED_TEXT[status] }];
    }),
  };
}

function projectRows(project: ReportProject): InfoRow[] {
  return [
    { field: "Project and client", value: `${project.code} · ${orNotEntered(project.client)}` },
    { field: "Building and address", value: `${orNotEntered(project.building)} · ${orNotEntered(project.address, "address not entered")}` },
    {
      field: "Inspection and report dates",
      value: `Inspection ${orNotEntered(project.inspectionDate)} · Report ${orNotEntered(project.reportDate)}`,
    },
    {
      field: "Employee and reviewer",
      value: `Prepared by ${orNotEntered(project.preparedBy)} · Reviewed by ${orNotEntered(project.reviewedBy, "pending")}`,
    },
    {
      field: "Scope and planned work",
      value: `${orNotEntered(project.scope, "Scope not entered")} · Planned work: ${orNotEntered(project.plannedWork)}`,
    },
    { field: "Status", value: REPORT_STATUS },
  ];
}

function findingSample(sample: SampleMatch): FindingSample {
  return {
    sampleId: sample.sampleId,
    status: sample.status,
    layers: sample.layers.map((layer): FindingLayer => {
      const first = layer.results[0];
      return {
        layer: layer.layer,
        status: layer.status,
        statusText: LAYER_STATUS_TEXT[layer.status],
        asbestosType: first?.asbestosType ?? null,
        percentage: first?.percentage ?? null,
        percentageRaw: first?.percentageRaw ?? null,
        sources: layer.results.map((row) => ({
          labResultId: row.id,
          labReportId: row.labReportId,
          fileName: row.fileName,
          page: row.page,
          quote: row.sourceText,
          resultLabel: row.resultLabel,
          asbestosType: row.asbestosType,
          percentageRaw: row.percentageRaw,
          labNote: row.labNote,
        })),
      };
    }),
  };
}

function costView(cost: ZoneCost): ZoneCostView {
  switch (cost.status) {
    case "PRICED":
      return { status: "PRICED", text: `CAD ${formatCad(cost.lineTotal)}`, lineTotal: cost.lineTotal };
    case "NOT_PRICED":
      return { status: "NOT_PRICED", text: `Not priced (${NOT_PRICED_SHORT[cost.reason]})`, lineTotal: null };
    case "NO_COST":
      return { status: "NO_COST", text: "No asbestos-specific cost (not detected in the sampled material)", lineTotal: null };
  }
}

const layersWith = (entry: ZoneAnalysis, status: LayerStatus) =>
  entry.samples.flatMap((sample) =>
    sample.layers.filter((layer) => layer.status === status).map((layer) => ({ sampleId: sample.sampleId, layer: layer.layer })),
  );

/** What is missing for one zone, in plain sentences. */
function zoneUncertainty(entry: ZoneAnalysis, issues: readonly IssueView[]): string[] {
  const lines: string[] = [];
  if (entry.zoneStatus === "UNSAMPLED") lines.push("No sample was taken from this zone, so its asbestos status is unknown.");
  if (entry.zoneStatus === "INACCESSIBLE") {
    lines.push("The zone was inaccessible and no sample was taken, so its asbestos status is unknown.");
  }
  for (const sample of entry.samples) {
    if (sample.layers.length === 0) lines.push(`No lab result has been received for sample ${sample.sampleId}.`);
  }
  for (const found of layersWith(entry, "INCONCLUSIVE")) {
    lines.push(`Sample ${found.sampleId}, layer "${found.layer}": the lab result is inconclusive.`);
  }
  for (const found of layersWith(entry, "CONFLICT")) {
    lines.push(`Sample ${found.sampleId}, layer "${found.layer}": the lab results conflict.`);
  }
  if (entry.zone.quantity === null) {
    lines.push(entry.zoneStatus === "DETECTED" ? "The quantity was not measured, so the zone is not priced." : "The quantity was not measured.");
  }
  if (entry.cost.status === "NOT_PRICED" && entry.cost.reason !== "UNRESOLVED" && entry.cost.reason !== "MISSING_QUANTITY") {
    lines.push(`No price is applied: ${NOT_PRICED_DETAIL[entry.cost.reason]}.`);
  }
  if (entry.zoneStatus === "NOT_DETECTED") lines.push("The not detected result applies only to the sampled material.");
  for (const found of issues) {
    if (found.state === "FLAGGED" && found.decision !== null && found.refs.zoneIds.includes(entry.zone.id)) {
      lines.push(`Flagged in the draft: ${found.decision.note}`);
    }
  }
  return lines;
}

function limitationItems(analysis: ProjectAnalysis): LimitationItem[] {
  const items: LimitationItem[] = [];
  const add = (kind: LimitationKind, entry: ZoneAnalysis | null, text: string) =>
    items.push({ kind, zoneId: entry?.zone.id ?? null, materialId: entry?.zone.materialId ?? null, text });
  const describe = (found: { sampleId: string; layer: string }[]) => joinAnd(found.map((item) => `${item.sampleId} (${item.layer})`));

  for (const entry of analysis.zones) {
    const label = zoneLabel(entry.zone);
    if (entry.zoneStatus === "INACCESSIBLE") add("INACCESSIBLE", entry, `${label}: inaccessible and not sampled; its asbestos status is unknown.`);
    if (entry.zoneStatus === "UNSAMPLED") add("UNSAMPLED", entry, `${label}: not sampled; its asbestos status is unknown.`);
    const inconclusive = layersWith(entry, "INCONCLUSIVE");
    if (inconclusive.length > 0) {
      add("INCONCLUSIVE", entry, `${label}: inconclusive lab result for ${describe(inconclusive)}; it stays unresolved.`);
    }
    const conflicts = layersWith(entry, "CONFLICT");
    if (conflicts.length > 0) add("CONFLICT", entry, `${label}: conflicting lab results for ${describe(conflicts)}; it stays unresolved.`);
    const awaiting = entry.samples.filter((sample) => sample.layers.length === 0).map((sample) => sample.sampleId);
    if (awaiting.length > 0) add("AWAITING_RESULT", entry, `${label}: no lab result received for ${joinAnd(awaiting)}; it stays unresolved.`);
  }
  for (const entry of analysis.zones) {
    if (entry.zone.quantity === null) add("MISSING_QUANTITY", entry, `${zoneLabel(entry.zone)}: quantity not measured.`);
  }
  for (const entry of analysis.zones) {
    if (entry.cost.status === "NOT_PRICED" && entry.cost.reason !== "UNRESOLVED" && entry.cost.reason !== "MISSING_QUANTITY") {
      add("NOT_PRICED", entry, `${zoneLabel(entry.zone)}: detected but not priced (${NOT_PRICED_DETAIL[entry.cost.reason]}).`);
    }
  }
  for (const entry of analysis.zones) {
    if (entry.zoneStatus !== "NOT_DETECTED") continue;
    const sampleIds = joinAnd(entry.samples.map((sample) => sample.sampleId));
    add("NOT_DETECTED_SCOPE", entry, `${zoneLabel(entry.zone)}: not detected applies only to the sampled material (${sampleIds}).`);
  }
  for (const flagged of analysis.flaggedLimitations) {
    add("FLAGGED_ISSUE", null, `Flagged in the draft: ${flagged.message} Employee note: ${flagged.note}`);
  }
  add("HIDDEN_MATERIALS", null, HIDDEN_MATERIALS_LIMITATION);
  return items;
}

function statusLine(checklist: ReviewChecklistState): string {
  const checked = CHECKLIST_ITEMS.filter((item) => checklist[item.key]).map((item) => item.short);
  const open = CHECKLIST_ITEMS.filter((item) => !checklist[item.key]).map((item) => item.short);
  const reviewer =
    checklist.reviewerName === null
      ? "pending"
      : `${checklist.reviewerName}${checklist.reviewedOn === null ? "" : `, ${checklist.reviewedOn}`}`;
  return [
    `${REPORT_STATUS}.`,
    `Checked: ${checked.length > 0 ? joinAnd(checked) : "none yet"}.`,
    `Not yet checked: ${open.length > 0 ? joinAnd(open) : "none"}.`,
    `Reviewer: ${reviewer}.`,
  ].join(" ");
}

function correctionTarget(subject: CorrectionSubject): string {
  switch (subject.kind) {
    case "LAB_ROW":
      return `${subject.sampleId} · ${subject.layer} · ${subject.labReportId} p.${subject.page}`;
    case "LAB_REPORT":
      return `Lab report file ${subject.fileName}`;
    case "UNKNOWN":
      return subject.entity;
  }
}

/** A stored correction value as text: "(empty)", the value itself, or a short row description. */
export function correctionValueText(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (field === "resultLabel" && (value === "DETECTED" || value === "NOT_DETECTED" || value === "INCONCLUSIVE")) {
    return formatResultLabel(value);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    const label = row.resultLabel;
    const result =
      label === "DETECTED" || label === "NOT_DETECTED" || label === "INCONCLUSIVE" ? formatResultLabel(label) : null;
    const parts = [row.sampleId, row.layer, result, typeof row.sourcePage === "number" ? `p.${row.sourcePage}` : null].filter(
      (part): part is string => typeof part === "string" && part !== "",
    );
    return parts.length > 0 ? parts.join(" · ") : "(row)";
  }
  return "(value)";
}

function correctionEntry(correction: ReportCorrection): CorrectionEntry {
  return {
    id: correction.id,
    target: correctionTarget(correction.subject),
    field: CORRECTION_FIELD_LABELS[correction.field] ?? correction.field,
    from: correctionValueText(correction.field, correction.oldValue),
    to: correctionValueText(correction.field, correction.newValue),
    reason: correction.reason,
    createdAt: correction.createdAt,
  };
}

function decisionEntries(analysis: ProjectAnalysis): DecisionEntry[] {
  const entries: DecisionEntry[] = [];
  for (const found of analysis.issues) {
    if ((found.state === "RESOLVED" || found.state === "FLAGGED") && found.decision !== null) {
      entries.push({
        issueKey: found.key,
        issueType: found.type,
        message: found.message,
        decision: found.decision.decision,
        note: found.decision.note,
        decidedAt: found.decision.decidedAt,
        state: "CURRENT",
      });
    }
    if (found.outdatedDecision !== null) {
      entries.push({
        issueKey: found.key,
        issueType: found.type,
        message: found.message,
        decision: found.outdatedDecision.decision,
        note: found.outdatedDecision.note,
        decidedAt: found.outdatedDecision.decidedAt,
        state: "OUTDATED",
      });
    }
  }
  for (const cleared of analysis.autoCleared) {
    entries.push({
      issueKey: cleared.issueKey,
      issueType: cleared.issueType,
      message: cleared.issueMessage,
      decision: cleared.decision,
      note: cleared.note,
      decidedAt: cleared.decidedAt,
      state: "AUTO_CLEARED",
    });
  }
  return entries;
}

const unique = <T>(values: readonly T[]) => [...new Set(values)];

function sampleRegister(analysis: ProjectAnalysis): SampleRegisterRow[] {
  const rows = analysis.zones.flatMap((entry) =>
    entry.samples.map(
      (sample): SampleRegisterRow => ({
        sampleId: sample.sampleId,
        materialId: entry.zone.materialId,
        location: entry.zone.location,
        status: sample.status,
        layerResults: sample.layers.length,
        labReportIds: unique(sample.layers.flatMap((layer) => layer.results.map((row) => row.labReportId))),
      }),
    ),
  );
  for (const unmatched of analysis.unmatchedSamples) {
    rows.push({
      sampleId: unmatched.sampleId,
      materialId: null,
      location: null,
      status: "UNMATCHED",
      layerResults: unmatched.rows.length,
      labReportIds: unique(unmatched.rows.map((row) => row.labReportId)),
    });
  }
  return rows;
}

function labSources(documents: readonly ReportLabDocument[], analysis: ProjectAnalysis): LabSourceDocument[] {
  return documents.map((document) => ({
    documentId: document.id,
    fileName: document.fileName,
    labReportId: document.labReportId,
    labName: document.labName,
    issuedDate: document.issuedDate,
    sha256: document.sha256,
    pageCount: document.pageCount,
    status: analysis.documents.find((state) => state.id === document.id)?.status ?? "UNKNOWN",
    rows: analysis.results
      .filter((row) => row.documentId === document.id)
      .map((row) => ({
        labResultId: row.id,
        sampleId: row.sampleId,
        layer: row.layer,
        resultLabel: row.resultLabel,
        asbestosType: row.asbestosType,
        percentageRaw: row.percentageRaw,
        page: row.page,
        quote: row.sourceText,
        labNote: row.labNote,
      })),
  }));
}
