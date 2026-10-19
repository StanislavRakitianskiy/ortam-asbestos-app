import { formatCad } from "@/domain/format";
import type { ZoneCost } from "@/domain/analysis";
import type { IssueState, ReadinessStatus } from "@/domain/issueResolution";
import type { LayerStatus, IssueType } from "@/domain/matching";
import type { AcceptedLabResult, Category, ZoneStatus } from "@/domain/types";

export const ZONE_STATUS_LABELS: Record<ZoneStatus, string> = {
  DETECTED: "Detected",
  NOT_DETECTED: "Not detected",
  INCONCLUSIVE: "Inconclusive",
  CONFLICT: "Conflicting results",
  AWAITING_RESULT: "Awaiting result",
  UNSAMPLED: "Unsampled",
  INACCESSIBLE: "Inaccessible",
};

const UNRESOLVED_CLASS = "bg-amber-500/15 text-amber-900 dark:text-amber-200";

export const ZONE_STATUS_CLASS: Record<ZoneStatus, string> = {
  DETECTED: "bg-red-500/10 text-red-800 dark:text-red-300",
  NOT_DETECTED: "bg-muted text-foreground",
  INCONCLUSIVE: UNRESOLVED_CLASS,
  CONFLICT: UNRESOLVED_CLASS,
  AWAITING_RESULT: UNRESOLVED_CLASS,
  UNSAMPLED: UNRESOLVED_CLASS,
  INACCESSIBLE: UNRESOLVED_CLASS,
};

export const LAYER_STATUS_LABELS: Record<LayerStatus, string> = {
  DETECTED: "Detected",
  NOT_DETECTED: "Not detected",
  INCONCLUSIVE: "Inconclusive",
  CONFLICT: "Conflicting results",
};

export const LAYER_STATUS_CLASS: Record<LayerStatus, string> = {
  DETECTED: "text-red-700 dark:text-red-400",
  NOT_DETECTED: "text-foreground",
  INCONCLUSIVE: "text-amber-800 dark:text-amber-300",
  CONFLICT: "text-amber-800 dark:text-amber-300",
};

export const CATEGORY_CLASS: Record<Category, string> = {
  A: "bg-red-600 text-white",
  B: "bg-orange-500/20 text-orange-900 dark:text-orange-200",
  C: "bg-amber-500/20 text-amber-900 dark:text-amber-200",
  D: "bg-muted text-foreground",
};

/** "LAB-A p.1": where a lab row is printed. */
export const sourceLabel = (row: Pick<AcceptedLabResult, "labReportId" | "page">) => `${row.labReportId} p.${row.page}`;

/** "Chrysotile 1%"; empty when the lab reported neither. */
export function contentText(row: Pick<AcceptedLabResult, "asbestosType" | "percentage">): string {
  return [row.asbestosType, row.percentage === null ? null : `${row.percentage}%`].filter(Boolean).join(" ");
}

const NOT_PRICED_TEXT: Record<Extract<ZoneCost, { status: "NOT_PRICED" }>["reason"], string> = {
  MISSING_QUANTITY: "quantity unknown",
  MISSING_RATE: "no rate reference",
  UNKNOWN_RATE_REF: "rate not on the rate card",
  RATE_UNIT_MISMATCH: "rate unit does not match the zone unit",
  UNRESOLVED: "unresolved",
};

export function costText(cost: ZoneCost): { main: string; detail: string | null } {
  switch (cost.status) {
    case "PRICED":
      return { main: formatCad(cost.lineTotal), detail: `removal ${formatCad(cost.removalAmount)} + replacement ${formatCad(cost.replacementAmount)}` };
    case "NOT_PRICED":
      return { main: "Not priced", detail: NOT_PRICED_TEXT[cost.reason] };
    case "NO_COST":
      return { main: "No cost line", detail: "not detected in the sampled material" };
  }
}

export const ISSUE_STATE_LABELS: Record<IssueState, string> = {
  OPEN: "Open",
  RESOLVED: "Resolved",
  FLAGGED: "Flagged in draft",
  INFO: "No decision needed",
};

export const ISSUE_STATE_CLASS: Record<IssueState, string> = {
  OPEN: "bg-destructive/10 text-destructive",
  RESOLVED: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  FLAGGED: "bg-amber-500/15 text-amber-900 dark:text-amber-200",
  INFO: "bg-muted text-muted-foreground",
};

/** Left border of an issue card by state, so open items stand out in a long list. */
export const ISSUE_STATE_BORDER: Record<IssueState, string> = {
  OPEN: "border-l-destructive",
  RESOLVED: "border-l-emerald-600",
  FLAGGED: "border-l-amber-500",
  INFO: "border-l-border",
};

export const READINESS_CLASS: Record<ReadinessStatus, string> = {
  BLOCKED: "border-destructive/40 bg-destructive/5",
  DRAFT_WITH_FLAGS: "border-amber-500/50 bg-amber-500/5",
  READY: "border-emerald-600/40 bg-emerald-500/5",
};

export type IssueGroupId =
  | "reports"
  | "unmatched"
  | "conflicts"
  | "duplicates"
  | "missing-results"
  | "evidence"
  | "rates"
  | "quantities"
  | "inconclusive"
  | "unsampled";

/** The "Needs attention" groups, in display order. */
export const ISSUE_GROUPS: { id: IssueGroupId; label: string }[] = [
  { id: "reports", label: "Lab reports not reviewed" },
  { id: "unmatched", label: "Unmatched IDs" },
  { id: "conflicts", label: "Conflicts" },
  { id: "duplicates", label: "Duplicates" },
  { id: "missing-results", label: "Missing lab results" },
  { id: "evidence", label: "Low confidence / evidence not found" },
  { id: "rates", label: "Rate mismatch" },
  { id: "quantities", label: "Missing quantities" },
  { id: "inconclusive", label: "Inconclusive results" },
  { id: "unsampled", label: "Unsampled / inaccessible" },
];

/** Every issue type belongs to one group; the Record type makes a new type fail to compile until it is placed. */
export const ISSUE_GROUP_OF: Record<IssueType, IssueGroupId> = {
  LAB_REPORT_NOT_REVIEWED: "reports",
  UNMATCHED_LAB_SAMPLE: "unmatched",
  CONFLICTING_RESULT: "conflicts",
  DUPLICATE_SAMPLE_IN_REGISTER: "duplicates",
  DUPLICATE_LAB_REPORT: "duplicates",
  MISSING_LAB_RESULT: "missing-results",
  EVIDENCE_NOT_VERIFIED: "evidence",
  LOW_CONFIDENCE: "evidence",
  RATE_UNIT_MISMATCH: "rates",
  UNKNOWN_RATE_REF: "rates",
  MISSING_RATE_FOR_DETECTED: "rates",
  MISSING_QUANTITY: "quantities",
  INCONCLUSIVE_RESULT: "inconclusive",
  UNSAMPLED_ZONE: "unsampled",
  INACCESSIBLE_ZONE: "unsampled",
};
