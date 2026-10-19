import { formatResultLabel } from "./format";
import { RATE_CARD, resolveRate, type RateCard } from "./rates";
import { normalizeSampleId } from "./sampleId";
import type { AcceptedLabResult, MaterialZone, ResultLabel, ZoneStatus } from "./types";

export type LayerStatus = ResultLabel | "CONFLICT";
export type SampleStatus = Exclude<ZoneStatus, "UNSAMPLED" | "INACCESSIBLE">;

export interface LayerMatch {
  /** Comparison key, see layerKey(). */
  layerKey: string;
  /** Layer text as first reported by the lab. */
  layer: string;
  /** CONFLICT when the counted results disagree. A conflicting layer never counts as detected. */
  status: LayerStatus;
  /** Every counted lab row for this sample layer. Identical rows from one lab report count once. */
  results: AcceptedLabResult[];
}

export interface SampleMatch {
  /** Normalized sample ID (trim + uppercase). */
  sampleId: string;
  status: SampleStatus;
  layers: LayerMatch[];
}

export const ISSUE_TYPES = [
  "UNMATCHED_LAB_SAMPLE",
  "DUPLICATE_SAMPLE_IN_REGISTER",
  "CONFLICTING_RESULT",
  "DUPLICATE_LAB_REPORT",
  "MISSING_LAB_RESULT",
  "INCONCLUSIVE_RESULT",
  "UNSAMPLED_ZONE",
  "INACCESSIBLE_ZONE",
  "MISSING_QUANTITY",
  "RATE_UNIT_MISMATCH",
  "UNKNOWN_RATE_REF",
  "MISSING_RATE_FOR_DETECTED",
  // Raised by src/domain/labRowIssues.ts from the review state of the lab reports and rows, not by matchProject.
  "LAB_REPORT_NOT_REVIEWED",
  "EVIDENCE_NOT_VERIFIED",
  "LOW_CONFIDENCE",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

/**
 * blocking: an ID or data problem the employee must resolve or explicitly flag.
 * warning: a legitimate limitation that the report carries as-is.
 */
export type IssueSeverity = "blocking" | "warning";

export interface IssueRefs {
  zoneIds: string[];
  sampleIds: string[];
  labResultIds: string[];
  documentIds: string[];
}

export interface ReviewIssue {
  /** Stable across recomputation: type plus the IDs it is about. */
  key: string;
  type: IssueType;
  severity: IssueSeverity;
  message: string;
  refs: IssueRefs;
}

export interface ZoneMatch {
  zoneId: string;
  materialId: string;
  zoneStatus: ZoneStatus;
  samples: SampleMatch[];
  /** Issues whose refs include this zone. */
  issues: ReviewIssue[];
}

export interface ProjectMatch {
  zones: ZoneMatch[];
  /** All issues, blocking first, then in the order found. */
  issues: ReviewIssue[];
}

export interface MatchOptions {
  rateCard?: RateCard;
}

/** Layers of one sample are compared by trimmed, whitespace-collapsed, lower-case text. Nothing more. */
export function layerKey(layer: string): string {
  return layer.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Unique normalized sample IDs of a zone, in register order. Blank entries are ignored. */
export function registeredSampleIds(zone: Pick<MaterialZone, "sampleIds">): string[] {
  return unique(zone.sampleIds.map(normalizeSampleId).filter((id) => id !== ""));
}

/**
 * Matches accepted lab rows to material zones by exact normalized sample ID within one project,
 * derives each zone's status and lists everything the employee has to review.
 */
export function matchProject(
  zones: readonly MaterialZone[],
  results: readonly AcceptedLabResult[],
  options: MatchOptions = {},
): ProjectMatch {
  const rateCard = options.rateCard ?? RATE_CARD;
  const issues = new IssueCollector();
  const layersBySample = groupLayers(results);
  const zonesBySample = indexRegister(zones);

  const zoneMatches = zones.map((zone) => {
    const samples = registeredSampleIds(zone).map((sampleId): SampleMatch => {
      const layers = layersBySample.get(sampleId) ?? [];
      return { sampleId, status: layers.length === 0 ? "AWAITING_RESULT" : aggregate(layers), layers };
    });
    const zoneStatus = deriveZoneStatus(zone, samples);
    addZoneIssues(issues, zone, samples, zoneStatus, rateCard);
    return { zoneId: zone.id, materialId: zone.materialId, zoneStatus, samples };
  });

  addDuplicateRegisterIssues(issues, zonesBySample, layersBySample);
  addConflictIssues(issues, layersBySample, zonesBySample);
  addUnmatchedIssues(issues, results, zonesBySample);
  addDuplicateReportIssues(issues, results);

  const all = issues.list();
  return {
    zones: zoneMatches.map((match) => ({
      ...match,
      issues: all.filter((issue) => issue.refs.zoneIds.includes(match.zoneId)),
    })),
    issues: all,
  };
}

/** Lab report IDs are compared like sample IDs: trim + uppercase. */
const reportKey = (labReportId: string) => labReportId.trim().toUpperCase();

function groupLayers(results: readonly AcceptedLabResult[]): Map<string, LayerMatch[]> {
  type Entry = { layer: string; results: AcceptedLabResult[]; counted: Set<string> };
  const grouped = new Map<string, Map<string, Entry>>();
  for (const result of results) {
    const layers = getOrCreate(grouped, normalizeSampleId(result.sampleId), () => new Map<string, Entry>());
    const entry = getOrCreate(layers, layerKey(result.layer), () => ({
      layer: result.layer.trim(),
      results: [],
      counted: new Set<string>(),
    }));
    // The same sample + layer + label from one lab report counts once (e.g. that report uploaded as two files).
    const identity = `${reportKey(result.labReportId)}|${result.resultLabel}`;
    if (entry.counted.has(identity)) continue;
    entry.counted.add(identity);
    entry.results.push(result);
  }

  const bySample = new Map<string, LayerMatch[]>();
  for (const [sampleId, layers] of grouped) {
    bySample.set(
      sampleId,
      [...layers].map(([key, entry]) => {
        const labels = new Set(entry.results.map((result) => result.resultLabel));
        const status = labels.size === 1 ? entry.results[0].resultLabel : "CONFLICT";
        return { layerKey: key, layer: entry.layer, status, results: entry.results };
      }),
    );
  }
  return bySample;
}

function indexRegister(zones: readonly MaterialZone[]): Map<string, MaterialZone[]> {
  const index = new Map<string, MaterialZone[]>();
  for (const zone of zones) {
    for (const sampleId of registeredSampleIds(zone)) getOrCreate(index, sampleId, () => []).push(zone);
  }
  return index;
}

/** Detected in any layer wins; a conflicting layer is not counted as detected until resolved. */
function aggregate(layers: readonly LayerMatch[]): "DETECTED" | "CONFLICT" | "INCONCLUSIVE" | "NOT_DETECTED" {
  if (layers.some((layer) => layer.status === "DETECTED")) return "DETECTED";
  if (layers.some((layer) => layer.status === "CONFLICT")) return "CONFLICT";
  if (layers.some((layer) => layer.status === "INCONCLUSIVE")) return "INCONCLUSIVE";
  return "NOT_DETECTED";
}

function deriveZoneStatus(zone: MaterialZone, samples: readonly SampleMatch[]): ZoneStatus {
  if (samples.length === 0) return zone.accessible ? "UNSAMPLED" : "INACCESSIBLE";
  const evidence = aggregate(samples.flatMap((sample) => sample.layers));
  if (evidence !== "NOT_DETECTED") return evidence;
  // Not detected is concluded only when every registered sample has a result.
  return samples.some((sample) => sample.layers.length === 0) ? "AWAITING_RESULT" : "NOT_DETECTED";
}

function addZoneIssues(
  issues: IssueCollector,
  zone: MaterialZone,
  samples: readonly SampleMatch[],
  zoneStatus: ZoneStatus,
  rateCard: RateCard,
) {
  const name = zone.materialId;
  const zoneIds = [zone.id];

  for (const sample of samples) {
    if (sample.layers.length === 0) {
      issues.add(
        issue(
          "MISSING_LAB_RESULT",
          [zone.id, sample.sampleId],
          "blocking",
          `No lab result matches sample ${sample.sampleId} in zone ${name}. Upload its lab report or check the sample ID.`,
          { zoneIds, sampleIds: [sample.sampleId] },
        ),
      );
    }
    for (const layer of sample.layers) {
      if (layer.status !== "INCONCLUSIVE") continue;
      issues.add(
        issue(
          "INCONCLUSIVE_RESULT",
          [zone.id, sample.sampleId, layer.layerKey],
          "warning",
          `Sample ${sample.sampleId}, layer "${layer.layer}" in zone ${name} is inconclusive. It stays unresolved until further evidence is supplied.`,
          { zoneIds, sampleIds: [sample.sampleId], ...rowRefs(layer.results) },
        ),
      );
    }
  }

  if (zoneStatus === "UNSAMPLED") {
    issues.add(
      issue(
        "UNSAMPLED_ZONE",
        [zone.id],
        "warning",
        `Zone ${name} has no sample ID. Its asbestos status is unknown and stays unresolved.`,
        { zoneIds },
      ),
    );
  }
  if (zoneStatus === "INACCESSIBLE") {
    issues.add(
      issue(
        "INACCESSIBLE_ZONE",
        [zone.id],
        "warning",
        `Zone ${name} was inaccessible and has no sample. Its asbestos status is unknown and stays unresolved.`,
        { zoneIds },
      ),
    );
  }

  const detected = zoneStatus === "DETECTED";
  if (detected && zone.quantity === null) {
    issues.add(
      issue(
        "MISSING_QUANTITY",
        [zone.id],
        "warning",
        `Zone ${name} is detected but its quantity is unknown. It is shown as Not priced until a quantity is entered.`,
        { zoneIds },
      ),
    );
  }

  const rate = resolveRate(zone.rateRef, zone.unit, rateCard);
  if (rate.ok) return;
  // A bad rate on a zone that will be priced is a data error; on other zones it is only a warning.
  const rateSeverity: IssueSeverity = detected ? "blocking" : "warning";
  switch (rate.reason) {
    case "NO_RATE_REF":
      if (detected) {
        issues.add(
          issue(
            "MISSING_RATE_FOR_DETECTED",
            [zone.id],
            "warning",
            `Zone ${name} is detected but has no rate reference. It is shown as Not priced.`,
            { zoneIds },
          ),
        );
      }
      break;
    case "UNKNOWN_RATE_REF":
      issues.add(
        issue(
          "UNKNOWN_RATE_REF",
          [zone.id, rate.rateRef],
          rateSeverity,
          `Zone ${name} references rate ${rate.rateRef}, which is not on the rate card. No price is applied.`,
          { zoneIds },
        ),
      );
      break;
    case "RATE_UNIT_MISMATCH":
      issues.add(
        issue(
          "RATE_UNIT_MISMATCH",
          [zone.id, rate.rate.ref],
          rateSeverity,
          `Zone ${name} is measured in ${zone.unit}, but rate ${rate.rate.ref} is priced per ${rate.rate.unit}. The rate is not applied; correct the unit or the rate reference.`,
          { zoneIds },
        ),
      );
      break;
  }
}

function addDuplicateRegisterIssues(
  issues: IssueCollector,
  zonesBySample: Map<string, MaterialZone[]>,
  layersBySample: Map<string, LayerMatch[]>,
) {
  for (const [sampleId, zones] of zonesBySample) {
    if (zones.length < 2) continue;
    const rows = (layersBySample.get(sampleId) ?? []).flatMap((layer) => layer.results);
    issues.add(
      issue(
        "DUPLICATE_SAMPLE_IN_REGISTER",
        [sampleId],
        "blocking",
        `Sample ${sampleId} is listed in more than one material zone (${zones.map((zone) => zone.materialId).join(", ")}). Its lab results are shown under each of them until it is assigned to one zone.`,
        { zoneIds: zones.map((zone) => zone.id), sampleIds: [sampleId], ...rowRefs(rows) },
      ),
    );
  }
}

function addConflictIssues(
  issues: IssueCollector,
  layersBySample: Map<string, LayerMatch[]>,
  zonesBySample: Map<string, MaterialZone[]>,
) {
  for (const [sampleId, layers] of layersBySample) {
    for (const layer of layers) {
      if (layer.status !== "CONFLICT") continue;
      const found = layer.results
        .map((result) => `${formatResultLabel(result.resultLabel)} in ${result.labReportId}`)
        .join(", ");
      issues.add(
        issue(
          "CONFLICTING_RESULT",
          [sampleId, layer.layerKey],
          "blocking",
          `Sample ${sampleId}, layer "${layer.layer}" has conflicting lab results: ${found}. Resolve the conflict or flag it in the draft; the layer stays unresolved until then.`,
          {
            zoneIds: (zonesBySample.get(sampleId) ?? []).map((zone) => zone.id),
            sampleIds: [sampleId],
            ...rowRefs(layer.results),
          },
        ),
      );
    }
  }
}

function addUnmatchedIssues(
  issues: IssueCollector,
  results: readonly AcceptedLabResult[],
  zonesBySample: Map<string, MaterialZone[]>,
) {
  const unmatched = new Map<string, AcceptedLabResult[]>();
  for (const result of results) {
    const sampleId = normalizeSampleId(result.sampleId);
    if (!zonesBySample.has(sampleId)) getOrCreate(unmatched, sampleId, () => []).push(result);
  }
  for (const [sampleId, rows] of unmatched) {
    const reports = unique(rows.map((row) => row.labReportId)).join(", ");
    issues.add(
      issue(
        "UNMATCHED_LAB_SAMPLE",
        [sampleId],
        "blocking",
        `Lab sample ${sampleId} (${reports}) does not match any sample ID in the material register. Correct the ID or add it to a zone; it is never matched automatically.`,
        { sampleIds: [sampleId], ...rowRefs(rows) },
      ),
    );
  }
}

function addDuplicateReportIssues(issues: IssueCollector, results: readonly AcceptedLabResult[]) {
  const byReport = new Map<string, AcceptedLabResult[]>();
  for (const result of results) getOrCreate(byReport, reportKey(result.labReportId), () => []).push(result);
  for (const [reportId, rows] of byReport) {
    const refs = rowRefs(rows);
    if (refs.documentIds.length < 2) continue;
    const files = unique(rows.map((row) => row.fileName)).join(", ");
    issues.add(
      issue(
        "DUPLICATE_LAB_REPORT",
        [reportId],
        "warning",
        `Lab report ${reportId} appears in ${refs.documentIds.length} uploaded files (${files}). Identical rows are counted once; check which file is current.`,
        { sampleIds: unique(rows.map((row) => normalizeSampleId(row.sampleId))), ...refs },
      ),
    );
  }
}

/** Builds an issue with its stable key: the type plus the IDs it is about. */
export function issue(
  type: IssueType,
  ids: readonly string[],
  severity: IssueSeverity,
  message: string,
  refs: Partial<IssueRefs>,
): ReviewIssue {
  return {
    key: [type, ...ids].join(":"),
    type,
    severity,
    message,
    refs: { zoneIds: [], sampleIds: [], labResultIds: [], documentIds: [], ...refs },
  };
}

class IssueCollector {
  private readonly byKey = new Map<string, ReviewIssue>();

  /** Keys are unique by construction: zone checks include the zone ID, project checks group by their own key. */
  add(found: ReviewIssue) {
    this.byKey.set(found.key, found);
  }

  /** Blocking first; within a severity, the order found (zone order, then project-wide checks). */
  list(): ReviewIssue[] {
    const rank = (found: ReviewIssue) => (found.severity === "blocking" ? 0 : 1);
    return [...this.byKey.values()].sort((a, b) => rank(a) - rank(b));
  }
}

function rowRefs(rows: readonly AcceptedLabResult[]): Pick<IssueRefs, "labResultIds" | "documentIds"> {
  return { labResultIds: rows.map((row) => row.id), documentIds: unique(rows.map((row) => row.documentId)) };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}
