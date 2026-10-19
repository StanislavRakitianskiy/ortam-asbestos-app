import { categorize, type Categorization } from "./categories";
import { computeEstimate, type CostEstimate, type CostLine, type NotPricedReason } from "./costs";
import {
  applyResolutions,
  flaggedLimitations,
  readiness,
  type ClearedDecision,
  type FlaggedLimitation,
  type IssueView,
  type Readiness,
  type StoredResolution,
} from "./issueResolution";
import { labRowIssues, type LabDocumentState, type RowEvidence } from "./labRowIssues";
import { matchProject, registeredSampleIds, type ReviewIssue, type SampleMatch } from "./matching";
import type { RateCard } from "./rates";
import { similarRegisteredIds } from "./similarIds";
import type { AcceptedLabResult, Cents, MaterialZone, ZoneStatus } from "./types";

export type AnalysisInput = {
  zones: readonly MaterialZone[];
  /** Accepted rows of fully reviewed lab reports only. */
  results: readonly AcceptedLabResult[];
  /** Evidence checks of those rows. */
  evidence: readonly RowEvidence[];
  /** Every uploaded lab report of the project, whatever its status. */
  documents: readonly LabDocumentState[];
  resolutions: readonly StoredResolution[];
  rateCard?: RateCard;
};

/** What the cost scenario does with a zone. Amounts come from computeEstimate; nothing is priced here. */
export type ZoneCost =
  | { status: "PRICED"; removalAmount: Cents; replacementAmount: Cents; lineTotal: Cents }
  | { status: "NOT_PRICED"; reason: NotPricedReason | "UNRESOLVED" }
  /** Not detected in the sampled material: no asbestos-specific cost in this exercise. */
  | { status: "NO_COST" };

export type ZoneAnalysis = {
  zone: MaterialZone;
  zoneStatus: ZoneStatus;
  samples: SampleMatch[];
  categorization: Categorization;
  cost: ZoneCost;
  /** Keys of the issues that refer to this zone. */
  issueKeys: string[];
};

export type SimilarRegisteredId = { sampleId: string; zones: { zoneId: string; materialId: string }[] };

/** A lab sample whose ID is not in the register. It is shown on its own and never linked to a zone automatically. */
export type UnmatchedSample = {
  sampleId: string;
  issueKey: string;
  rows: AcceptedLabResult[];
  /** Text hint only ("Similar ID in register: S07"). */
  similar: SimilarRegisteredId[];
};

/** The single source for the Matching view, the report and the plans. */
export type ProjectAnalysis = {
  zones: ZoneAnalysis[];
  unmatchedSamples: UnmatchedSample[];
  /** Blocking first. */
  issues: IssueView[];
  autoCleared: ClearedDecision[];
  flaggedLimitations: FlaggedLimitation[];
  estimate: CostEstimate;
  readiness: Readiness;
  /** Every accepted row used, for source references. */
  results: AcceptedLabResult[];
  documents: LabDocumentState[];
};

/** Matches accepted lab rows to zones, applies categories A–D and the cost rules, and joins the employee's decisions. */
export function analyzeProject(input: AnalysisInput): ProjectAnalysis {
  const options = { rateCard: input.rateCard };
  const match = matchProject(input.zones, input.results, options);
  const estimate = computeEstimate(input.zones, match.zones, options);
  const rowIssues = labRowIssues(input.zones, input.documents, input.results, input.evidence);
  const severityRank = (found: ReviewIssue) => (found.severity === "blocking" ? 0 : 1);
  const isDocumentIssue = (found: ReviewIssue) => found.type === "LAB_REPORT_NOT_REVIEWED";
  // Unreviewed lab reports first: until they are accepted, the other issues may still change.
  const allIssues = [
    ...rowIssues.filter(isDocumentIssue),
    ...match.issues,
    ...rowIssues.filter((found) => !isDocumentIssue(found)),
  ].sort((first, second) => severityRank(first) - severityRank(second));
  const decided = applyResolutions(allIssues, input.resolutions);

  const zones = input.zones.map((zone, index): ZoneAnalysis => {
    const zoneMatch = match.zones[index];
    return {
      zone,
      zoneStatus: zoneMatch.zoneStatus,
      samples: zoneMatch.samples,
      categorization: categorize(zone, zoneMatch),
      cost: zoneCost(zoneMatch.zoneStatus, estimate.lines.find((line) => line.zoneId === zone.id)),
      issueKeys: allIssues.filter((found) => found.refs.zoneIds.includes(zone.id)).map((found) => found.key),
    };
  });

  return {
    zones,
    unmatchedSamples: unmatchedSamples(input.zones, input.results, allIssues),
    issues: decided.issues,
    autoCleared: decided.autoCleared,
    flaggedLimitations: flaggedLimitations(decided.issues),
    estimate,
    readiness: readiness(decided.issues),
    results: [...input.results],
    documents: [...input.documents],
  };
}

function zoneCost(status: ZoneStatus, line: CostLine | undefined): ZoneCost {
  if (status === "NOT_DETECTED") return { status: "NO_COST" };
  if (status !== "DETECTED") return { status: "NOT_PRICED", reason: "UNRESOLVED" };
  if (line === undefined) throw new Error("A detected zone has no cost line.");
  if (line.status === "NOT_PRICED") return { status: "NOT_PRICED", reason: line.notPricedReason };
  return {
    status: "PRICED",
    removalAmount: line.removalAmount,
    replacementAmount: line.replacementAmount,
    lineTotal: line.lineTotal,
  };
}

function unmatchedSamples(
  zones: readonly MaterialZone[],
  results: readonly AcceptedLabResult[],
  issues: readonly ReviewIssue[],
): UnmatchedSample[] {
  const registered = zones.flatMap((zone) => registeredSampleIds(zone).map((sampleId) => ({ sampleId, zone })));
  const registeredIds = registered.map((entry) => entry.sampleId);
  return issues
    .filter((found) => found.type === "UNMATCHED_LAB_SAMPLE")
    .map((found) => {
      const sampleId = found.refs.sampleIds[0];
      return {
        sampleId,
        issueKey: found.key,
        rows: results.filter((row) => found.refs.labResultIds.includes(row.id)),
        similar: similarRegisteredIds(sampleId, registeredIds).map((similarId) => ({
          sampleId: similarId,
          zones: registered
            .filter((entry) => entry.sampleId === similarId)
            .map((entry) => ({ zoneId: entry.zone.id, materialId: entry.zone.materialId })),
        })),
      };
    });
}
