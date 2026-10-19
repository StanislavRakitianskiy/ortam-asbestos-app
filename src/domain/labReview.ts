/**
 * Review state of extracted lab rows. The employee accepts or rejects every row; only accepted rows of a fully
 * reviewed document are used for matching and the report. Pure: no I/O.
 */

export const REVIEW_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type ReviewedRow = { reviewStatus: ReviewStatus };

export type BulkCandidate = ReviewedRow & {
  evidenceVerified: boolean;
  /** HIGH | MEDIUM | LOW from the AI; null for a row the employee added. */
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  flags: readonly unknown[];
};

/**
 * "Accept all verified" takes a pending row only when its quote is on exactly one line of the cited page, its
 * confidence is not low and no verification check is open (a correction can raise a new one). Everything else is
 * accepted one row at a time, after the employee has looked at the source.
 */
export function isBulkAcceptable(row: BulkCandidate): boolean {
  return row.reviewStatus === "PENDING" && row.evidenceVerified && row.confidence !== "LOW" && row.flags.length === 0;
}

export type ReviewProgress = { total: number; reviewed: number; pending: number; accepted: number; rejected: number };

export function reviewProgress(rows: readonly ReviewedRow[]): ReviewProgress {
  const accepted = rows.filter((row) => row.reviewStatus === "ACCEPTED").length;
  const rejected = rows.filter((row) => row.reviewStatus === "REJECTED").length;
  return { total: rows.length, reviewed: accepted + rejected, pending: rows.length - accepted - rejected, accepted, rejected };
}

/**
 * A document is accepted once it has at least one row and every row is accepted or rejected. A document without
 * rows stays in review: nothing was confirmed, so there is nothing to accept.
 */
export function documentReviewOutcome(rows: readonly ReviewedRow[]): "ACCEPTED" | "NEEDS_REVIEW" {
  return rows.length > 0 && rows.every((row) => row.reviewStatus !== "PENDING") ? "ACCEPTED" : "NEEDS_REVIEW";
}
