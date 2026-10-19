import type { LabDocumentStatus } from "./labReview";
import { issue, registeredSampleIds, type ReviewIssue } from "./matching";
import { normalizeSampleId } from "./sampleId";
import type { AcceptedLabResult, MaterialZone } from "./types";

/** An uploaded lab report and how far its review has got. */
export type LabDocumentState = {
  id: string;
  fileName: string;
  labReportId: string | null;
  status: LabDocumentStatus;
  /** Rows not yet accepted or rejected. */
  pendingRows: number;
};

/** The evidence checks of one accepted lab row, as stored after the employee's review. */
export type RowEvidence = {
  labResultId: string;
  /** The quoted line was found on exactly one line of the cited page. */
  evidenceVerified: boolean;
  /** The AI's own confidence; null for a row the employee added. */
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  /** Open verification checks on the current values. */
  flags: readonly { code: string; message: string }[];
};

/**
 * Review issues that come from the lab reports themselves rather than from matching:
 * - a lab report that is not fully reviewed contributes nothing, so the draft would silently miss its results;
 * - an accepted row whose quote is not on the cited page, or that has an open check, would be cited in the report
 *   with evidence nobody could find again;
 * - an accepted row with low AI confidence is listed for information (its quote was found).
 */
export function labRowIssues(
  zones: readonly MaterialZone[],
  documents: readonly LabDocumentState[],
  results: readonly AcceptedLabResult[],
  evidence: readonly RowEvidence[],
): ReviewIssue[] {
  const zoneIdsBySample = new Map<string, string[]>();
  for (const zone of zones) {
    for (const sampleId of registeredSampleIds(zone)) zoneIdsBySample.set(sampleId, [...(zoneIdsBySample.get(sampleId) ?? []), zone.id]);
  }
  const evidenceById = new Map(evidence.map((row) => [row.labResultId, row]));

  const documentIssues = documents
    .filter((document) => document.status !== "ACCEPTED")
    .map((document) =>
      issue("LAB_REPORT_NOT_REVIEWED", [document.id], "blocking", notReviewedMessage(document), { documentIds: [document.id] }),
    );

  const rowIssues = results.flatMap((row): ReviewIssue[] => {
    const checks = evidenceById.get(row.id);
    if (checks === undefined) return [];
    const sampleId = normalizeSampleId(row.sampleId);
    const refs = {
      zoneIds: zoneIdsBySample.get(sampleId) ?? [],
      sampleIds: [sampleId],
      labResultIds: [row.id],
      documentIds: [row.documentId],
    };
    const where = `Lab row ${sampleId} "${row.layer}" (${row.labReportId}, page ${row.page})`;
    if (!checks.evidenceVerified || checks.flags.length > 0) {
      const problem = checks.evidenceVerified
        ? "was accepted with open evidence checks."
        : "was accepted, but its quoted line was not found on exactly one line of the cited page.";
      const details = checks.flags.map((flag) => flag.message).join(" ");
      return [
        issue(
          "EVIDENCE_NOT_VERIFIED",
          [row.id],
          "blocking",
          `${where} ${problem}${details ? ` ${details}` : ""} Check it against the PDF and correct or reject the row, or resolve or flag this issue.`,
          refs,
        ),
      ];
    }
    if (checks.confidence === "LOW") {
      return [
        issue(
          "LOW_CONFIDENCE",
          [row.id],
          "warning",
          `${where} had low AI confidence. Its quoted line was found on the cited page and the row was accepted after review.`,
          refs,
        ),
      ];
    }
    return [];
  });

  return [...documentIssues, ...rowIssues];
}

function notReviewedMessage(document: LabDocumentState): string {
  const name = document.labReportId ? `${document.fileName} (${document.labReportId})` : document.fileName;
  switch (document.status) {
    case "UPLOADED":
    case "EXTRACTING":
      return `${name} is still being extracted. None of its results are used yet.`;
    case "FAILED":
      return `The extraction of ${name} failed, so none of its results are used. Retry it on the Lab reports tab.`;
    case "NEEDS_REVIEW":
    case "ACCEPTED":
      if (document.pendingRows === 0) return `${name} has no result rows, so nothing from it is used. Add its rows by hand or extract it again.`;
      return `${name} has ${document.pendingRows} row${document.pendingRows === 1 ? "" : "s"} pending review. None of its results are used until every row is accepted or rejected.`;
  }
}
