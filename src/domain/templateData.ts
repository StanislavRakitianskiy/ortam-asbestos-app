import { formatCad, formatResultLabel } from "./format";
import { NARRATIVE_LABELS, type NarrativeBlock, type NarrativeSection } from "./narrative";
import type { CostRow, FindingLayer, FindingSample, LayerSource, ReportModel, SampleRegisterRow, ZoneFinding } from "./reportModel";
import { joinAnd, plural } from "./reportText";
import type { ChecklistKey } from "./reviewChecklist";
import type { Cents, ResultLabel, Unit } from "./types";

/**
 * The values of the Word template (templates/report_template.docx, built by scripts/build-template.ts). Pure: the
 * same report model and revision give the same data. Every value is already the text the report prints; nothing is
 * null, so a tag without a value is a bug that renderDocx reports instead of printing "undefined".
 *
 * Inside a loop docxtemplater looks a missing tag up in the outer levels, so the keys of each level are distinct from
 * the keys of the levels around it (zones use zone…, cost lines cost…, appendix rows src…, smp…, cor…, dec…; every
 * paragraph list uses { text }, and no outer level has a text key).
 */

export type TemplateLine = { text: string };

export type TemplateLayer = { layerEvidence: string; layerResult: string };

export type TemplateZone = {
  materialId: string;
  zoneDescription: string;
  zoneLocation: string;
  fieldLines: TemplateLine[];
  layers: TemplateLayer[];
  interpretationLines: TemplateLine[];
  actionLines: TemplateLine[];
  uncertaintyLines: TemplateLine[];
};

export type TemplateCostLine = { costZone: string; costQuantity: string; costRemoval: string; costReplacement: string; costTotal: string };
export type TemplateLabSourceRow = { srcReport: string; srcFile: string; srcPage: string; srcSample: string; srcLayer: string; srcQuote: string };
export type TemplateSampleRow = { smpSample: string; smpZone: string; smpLocation: string; smpStatus: string; smpLayers: string; smpReports: string };
export type TemplateCorrectionRow = { corDate: string; corTarget: string; corField: string; corFrom: string; corTo: string; corReason: string };
export type TemplateDecisionRow = { decIssue: string; decDecision: string; decNote: string; decDate: string; decState: string };

export type TemplateData = {
  projectCode: string;
  revisionNumber: string;
  generatedAt: string;
  snapshotShort: string;
  reportStatusNote: string;
  infoProjectClient: string;
  infoBuildingAddress: string;
  infoDates: string;
  infoPeople: string;
  infoScope: string;
  summaryParagraphs: TemplateLine[];
  summaryFacts: string;
  findingsIntro: string;
  zones: TemplateZone[];
  recommendations: TemplateLine[];
  limitations: TemplateLine[];
  costLines: TemplateCostLine[];
  removalSubtotal: string;
  replacementSubtotal: string;
  zoneSubtotal: string;
  mobilization: string;
  assessment: string;
  direct: string;
  contingencyPercent: string;
  contingency: string;
  total: string;
  assumptionLines: TemplateLine[];
  exclusionLines: TemplateLine[];
  reviewLines: TemplateLine[];
  checkSamples: string;
  checkLayers: string;
  checkQuantities: string;
  checkCosts: string;
  checkNarrative: string;
  reviewerAndDate: string;
  labDocumentLines: TemplateLine[];
  hasLabSources: boolean;
  labSourceRows: TemplateLabSourceRow[];
  hasSampleRows: boolean;
  sampleRows: TemplateSampleRow[];
  hasCorrectionRows: boolean;
  correctionRows: TemplateCorrectionRow[];
  hasDecisionRows: boolean;
  decisionRows: TemplateDecisionRow[];
  hasPlans: boolean;
  planNote: string;
};

/**
 * Version of what toTemplateData prints for a given model. It is part of the snapshot hash, so a change of wording or
 * layout here marks earlier revisions outdated, as a new template does. A golden test fails until it is raised.
 */
export const REPORT_RENDERER_VERSION = 1;

/** What the revision adds to the snapshot. Not part of the snapshot hash. */
export type RevisionMeta = { revisionNumber: number; generatedAt: string; snapshotHash: string };

/** Printed where a narrative text has not been drafted or written. */
export const NARRATIVE_MISSING_TEXT = "Narrative not written yet.";

export const FINDINGS_INTRO =
  "One record per material zone, in register order. Every sample ID and every lab layer result is kept: a layered sample shows each layer with its own result and lab source.";

const SAMPLE_STATUS_TEXT: Record<SampleRegisterRow["status"], string> = {
  DETECTED: "Detected",
  NOT_DETECTED: "Not detected",
  INCONCLUSIVE: "Inconclusive",
  CONFLICT: "Conflicting results",
  AWAITING_RESULT: "Awaiting lab result",
  UNMATCHED: "Lab sample not in the register",
};

const DOCUMENT_STATUS_TEXT: Record<string, string> = {
  ACCEPTED: "accepted, rows used",
  NEEDS_REVIEW: "in review, rows not used",
  EXTRACTING: "extracting, rows not used",
  UPLOADED: "uploaded, rows not used",
  FAILED: "extraction failed, rows not used",
};

const DECISION_STATE_TEXT = { CURRENT: "Applies", OUTDATED: "Outdated: evidence changed", AUTO_CLEARED: "Issue no longer present" } as const;

// ---------------------------------------------------------------- small helpers

const lines = (texts: readonly string[]): TemplateLine[] => texts.map((text) => ({ text }));
const orText = (value: string | null, fallback: string) => (value === null || value.trim() === "" ? fallback : value.trim());
const yesNo = (value: boolean) => (value ? "Yes" : "No");
const unique = (values: readonly string[]) => [...new Set(values)];

/** Paragraphs are separated by a blank line (D-035); a single line break stays inside its paragraph. */
const paragraphsOf = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== "");

const linesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const narrativeParagraphs = (block: NarrativeBlock) => {
  const found = paragraphsOf(block.text);
  return found.length > 0 ? found : [NARRATIVE_MISSING_TEXT];
};

/** "2026-10-19T14:32:05.000Z" → "2026-10-19 14:32". */
const utcMinute = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) throw new RangeError(`Not an ISO timestamp: ${iso}`);
  return iso.slice(0, 16).replace("T", " ");
};

const rateText = (cents: Cents | null, unit: Unit, materialId: string) => {
  if (cents === null) throw new Error(`Priced cost line ${materialId} has no rate.`);
  return `${formatCad(cents)} / ${unit}`;
};

// ---------------------------------------------------------------- narrative coverage

/** Every narrative slot of the report with its label, in report order. */
export function narrativeSlots(model: ReportModel): { label: string; block: NarrativeBlock; optional: boolean }[] {
  const zoneLabel = (finding: ZoneFinding, section: NarrativeSection) => `${finding.materialId} · ${NARRATIVE_LABELS[section]}`;
  return [
    { label: NARRATIVE_LABELS.executiveSummary, block: model.executiveSummary.narrative, optional: false },
    ...model.findings.flatMap((finding) => [
      { label: zoneLabel(finding, "zoneInterpretation"), block: finding.narrative.interpretation, optional: false },
      { label: zoneLabel(finding, "zoneReason"), block: finding.narrative.reason, optional: false },
      { label: zoneLabel(finding, "zoneUncertainty"), block: finding.narrative.uncertainty, optional: false },
      { label: zoneLabel(finding, "zoneFollowUp"), block: finding.narrative.followUp, optional: false },
    ]),
    ...model.recommendations.map((item) => ({ label: `${item.materialId} · ${NARRATIVE_LABELS.recommendation}`, block: item.narrative, optional: false })),
    // "Additional limitations": the code-built limitations are complete without it.
    { label: NARRATIVE_LABELS.limitations, block: model.scopeLimitations.narrative, optional: true },
  ];
}

/** Narrative texts that the report would print as "Narrative not written yet.". */
export function missingNarrative(model: ReportModel): string[] {
  return narrativeSlots(model)
    .filter((slot) => !slot.optional && slot.block.text.trim() === "")
    .map((slot) => slot.label);
}

function reportStatusNote(model: ReportModel): string {
  const slots = narrativeSlots(model);
  const written = slots.filter((slot) => slot.block.text.trim() !== "").length;
  const edited = slots.filter((slot) => slot.block.text.trim() !== "" && slot.block.source === "EDITED").length;
  return [
    `${model.status}.`,
    "Generated by the ORTAM report app from the material zones and the lab results the employee reviewed.",
    `Findings, categories and amounts are computed in code; narrative texts are AI drafts that the employee checks and may edit (${written} of ${slots.length} written, ${edited} edited by the employee).`,
    `Readiness at generation: ${model.employeeReview.readiness.label}.`,
  ].join(" ");
}

// ---------------------------------------------------------------- findings

const sourceRef = (source: LayerSource) => `${source.labReportId} · ${source.fileName}, page ${source.page}`;

function resultText(label: ResultLabel, asbestosType: string | null, percentage: string | null): string {
  return [formatResultLabel(label), orText(asbestosType, ""), orText(percentage, "")].filter((part) => part !== "").join(" · ");
}

function layerResult(layer: FindingLayer): string {
  if (layer.status === "CONFLICT") {
    return `Conflicting results: ${layer.sources
      .map((source) => `${source.labReportId} ${resultText(source.resultLabel, source.asbestosType, source.percentageRaw)}`)
      .join("; ")}`;
  }
  const percentage = layer.percentageRaw ?? (layer.percentage === null ? null : `${layer.percentage}%`);
  return resultText(layer.status, layer.asbestosType, percentage);
}

function sampleLayers(sample: FindingSample): TemplateLayer[] {
  if (sample.layers.length === 0) {
    return [{ layerEvidence: `${sample.sampleId} · no lab result received`, layerResult: "Awaiting lab result (unresolved)" }];
  }
  return sample.layers.map((layer) => {
    const sources = layer.sources.length > 0 ? unique(layer.sources.map(sourceRef)).join("; ") : "Lab source not recorded";
    return { layerEvidence: `${sources} · ${sample.sampleId} · ${layer.layer}`, layerResult: layerResult(layer) };
  });
}

function zone(finding: ZoneFinding): TemplateZone {
  const field = finding.fieldEvidence;
  const notes = field.notes.trim();
  const [followUp, ...moreFollowUp] = narrativeParagraphs(finding.narrative.followUp);
  return {
    materialId: finding.materialId,
    zoneDescription: finding.description,
    zoneLocation: [finding.materialId, orText(finding.floor, "floor not entered"), orText(finding.location, "location not entered"), finding.description].join(" · "),
    fieldLines: lines([
      `Condition: ${field.condition}`,
      `Quantity: ${field.quantity === null ? "Unknown (not measured)" : field.quantityText}`,
      `Planned disturbance: ${yesNo(field.plannedDisturbance)}`,
      `Accessible: ${yesNo(field.accessible)}`,
      ...(notes === "" ? [] : [`Field notes: ${notes}`]),
    ]),
    // A table cell needs at least one paragraph, so an unsampled zone gets one line too.
    layers:
      finding.samples.length === 0
        ? [{ layerEvidence: "No sample taken", layerResult: finding.interpretation }]
        : finding.samples.flatMap(sampleLayers),
    interpretationLines: lines([finding.interpretation, ...narrativeParagraphs(finding.narrative.interpretation)]),
    actionLines: lines([
      `Category ${finding.category}: ${finding.categoryTitle}`,
      finding.reasonText,
      `Cost scenario: ${finding.cost.text}`,
      ...narrativeParagraphs(finding.narrative.reason),
    ]),
    uncertaintyLines: lines([
      ...finding.uncertainty,
      ...narrativeParagraphs(finding.narrative.uncertainty),
      `Required follow-up: ${followUp}`,
      ...moreFollowUp,
    ]),
  };
}

function recommendations(model: ReportModel): TemplateLine[] {
  return model.recommendations.flatMap((item) => {
    const samples = item.sampleIds.length === 0 ? "not sampled" : `${item.sampleIds.length === 1 ? "sample" : "samples"} ${joinAnd(item.sampleIds)}`;
    const [first, ...rest] = narrativeParagraphs(item.narrative);
    return lines([`${item.materialId} ${item.description}, ${item.location} (${samples}) — Category ${item.category}, ${item.categoryTitle}: ${first}`, ...rest]);
  });
}

// ---------------------------------------------------------------- costs

function costLine(line: CostRow): TemplateCostLine {
  const costZone = `${line.materialId} ${line.description}`;
  if (!line.priced) {
    return { costZone, costQuantity: line.quantityText, costRemoval: "Not priced", costReplacement: "Not priced", costTotal: line.notPricedText ?? "Not priced" };
  }
  if (line.lineTotal === null) throw new Error(`Priced cost line ${line.materialId} has no line total.`);
  return {
    costZone,
    costQuantity: line.quantityText,
    costRemoval: rateText(line.removalRate, line.unit, line.materialId),
    costReplacement: rateText(line.replacementRate, line.unit, line.materialId),
    costTotal: formatCad(line.lineTotal),
  };
}

const NO_COST_LINE: TemplateCostLine = {
  costZone: "None",
  costQuantity: "—",
  costRemoval: "—",
  costReplacement: "—",
  costTotal: "No detected zone to price",
};

// ---------------------------------------------------------------- review and appendices

function infoValue(model: ReportModel, field: string): string {
  const row = model.projectInformation.rows.find((candidate) => candidate.field === field);
  if (row === undefined) throw new Error(`Project information has no "${field}" row.`);
  return row.value;
}

function reviewLines(model: ReportModel): TemplateLine[] {
  const current = model.appendices.decisions.filter((entry) => entry.state === "CURRENT");
  const resolved = current.filter((entry) => entry.decision === "RESOLVED").length;
  const flagged = current.filter((entry) => entry.decision === "FLAGGED").length;
  const corrections = model.appendices.corrections.length;
  return lines([
    model.employeeReview.statusLine,
    `Readiness at generation: ${model.employeeReview.readiness.label}.`,
    `Employee corrections: ${plural(corrections, "correction")} of extracted lab data, each logged with a reason (Appendix C).`,
    `Review items: ${resolved} resolved and ${flagged} kept flagged in this draft (Appendix D).`,
    `Lab source references are in Appendix A and the sample register in Appendix B.${model.appendices.plan === null ? " No floor plan is attached." : ""}`,
  ]);
}

type ChecklistValues = Pick<TemplateData, "checkSamples" | "checkLayers" | "checkQuantities" | "checkCosts" | "checkNarrative" | "reviewerAndDate">;

function checklistValues(model: ReportModel): ChecklistValues {
  const value = (key: ChecklistKey) => {
    const item = model.employeeReview.checklist.find((candidate) => candidate.key === key);
    if (item === undefined) throw new Error(`Review checklist has no "${key}" item.`);
    return `${item.label}: ${item.checked ? "yes" : "not yet"}`;
  };
  const { reviewerName, reviewedOn } = model.employeeReview;
  return {
    checkSamples: value("samplesChecked"),
    checkLayers: value("layersChecked"),
    checkQuantities: value("quantitiesChecked"),
    checkCosts: value("costsChecked"),
    checkNarrative: value("narrativeChecked"),
    reviewerAndDate: reviewerName === null ? "Reviewer: pending" : `Reviewer: ${reviewerName}${reviewedOn === null ? "" : `, ${reviewedOn}`}`,
  };
}

function appendixValues(model: ReportModel) {
  const documents = model.appendices.labSources;
  const labSourceRows = documents.flatMap((document) =>
    document.rows.map(
      (row): TemplateLabSourceRow => ({
        srcReport: orText(document.labReportId, "Not printed"),
        srcFile: document.fileName,
        srcPage: String(row.page),
        srcSample: row.sampleId,
        srcLayer: row.layer,
        srcQuote: row.quote,
      }),
    ),
  );
  const sampleRows = model.appendices.sampleRegister.map(
    (row): TemplateSampleRow => ({
      smpSample: row.sampleId,
      smpZone: row.materialId ?? "Not in register",
      smpLocation: row.location ?? "—",
      smpStatus: SAMPLE_STATUS_TEXT[row.status],
      smpLayers: String(row.layerResults),
      smpReports: row.labReportIds.length > 0 ? row.labReportIds.join(", ") : "None received",
    }),
  );
  const correctionRows = model.appendices.corrections.map(
    (entry): TemplateCorrectionRow => ({
      corDate: utcMinute(entry.createdAt),
      corTarget: entry.target,
      corField: entry.field,
      corFrom: entry.from,
      corTo: entry.to,
      corReason: entry.reason,
    }),
  );
  const decisionRows = model.appendices.decisions.map(
    (entry): TemplateDecisionRow => ({
      decIssue: entry.message,
      decDecision: entry.decision === "RESOLVED" ? "Resolved" : "Kept flagged",
      decNote: entry.note,
      decDate: utcMinute(entry.decidedAt),
      decState: DECISION_STATE_TEXT[entry.state],
    }),
  );
  return {
    labDocumentLines: lines(
      documents.map(
        (document) =>
          `${document.fileName}: report ${orText(document.labReportId, "ID not printed")}, ${orText(document.labName, "laboratory not named")}, ` +
          `issued ${orText(document.issuedDate, "date not printed")}, ${plural(document.pageCount, "page")}, ` +
          `review status ${DOCUMENT_STATUS_TEXT[document.status] ?? document.status}, SHA-256 ${document.sha256}.`,
      ),
    ),
    hasLabSources: labSourceRows.length > 0,
    labSourceRows,
    hasSampleRows: sampleRows.length > 0,
    sampleRows,
    hasCorrectionRows: correctionRows.length > 0,
    correctionRows,
    hasDecisionRows: decisionRows.length > 0,
    decisionRows,
    hasPlans: model.appendices.plan !== null,
    planNote: "",
  };
}

// ---------------------------------------------------------------- builder

export function toTemplateData(model: ReportModel, meta: RevisionMeta): TemplateData {
  const { summary } = model.costScenario;
  const costLines = model.costScenario.lines.map(costLine);
  return {
    projectCode: model.projectInformation.project.code,
    revisionNumber: String(meta.revisionNumber),
    generatedAt: `${utcMinute(meta.generatedAt)} UTC`,
    snapshotShort: meta.snapshotHash.slice(0, 12),
    reportStatusNote: reportStatusNote(model),
    infoProjectClient: infoValue(model, "Project and client"),
    infoBuildingAddress: infoValue(model, "Building and address"),
    infoDates: infoValue(model, "Inspection and report dates"),
    infoPeople: infoValue(model, "Employee and reviewer"),
    infoScope: infoValue(model, "Scope and planned work"),
    summaryParagraphs: lines(narrativeParagraphs(model.executiveSummary.narrative)),
    summaryFacts: model.executiveSummary.factsParagraph,
    findingsIntro: FINDINGS_INTRO,
    zones: model.findings.map(zone),
    recommendations: recommendations(model),
    limitations: lines([
      ...model.scopeLimitations.items.map((item) => item.text),
      ...linesOf(model.scopeLimitations.projectLimitations),
      ...linesOf(model.scopeLimitations.narrative.text),
      ...model.scopeLimitations.standing,
    ]),
    costLines: costLines.length > 0 ? costLines : [NO_COST_LINE],
    removalSubtotal: formatCad(summary.removalSubtotal),
    replacementSubtotal: formatCad(summary.replacementSubtotal),
    zoneSubtotal: formatCad(summary.zoneSubtotal),
    mobilization: formatCad(summary.mobilization),
    assessment: formatCad(summary.assessment),
    direct: formatCad(summary.direct),
    contingencyPercent: String(summary.contingencyPercent),
    contingency: formatCad(summary.contingency),
    total: formatCad(summary.total),
    assumptionLines: lines(model.assumptionsAndExclusions.assumptions),
    exclusionLines: lines(model.assumptionsAndExclusions.exclusions.map((item) => item.text)),
    reviewLines: reviewLines(model),
    ...checklistValues(model),
    ...appendixValues(model),
  };
}
