import type { LabResult, Prisma } from "@prisma/client";
import { documentReviewOutcome } from "@/domain/labReview";
import { resultLabelSchema } from "@/domain/types";
import { checkResultRows, type CheckedRow } from "@/server/ai/verifyExtraction";
import { labDocumentStatusSchema, reviewStatusSchema } from "@/server/dbEnums";
import { flagsSchema, pagesSchema, REVIEWABLE_STATUSES, type FlagDto } from "@/server/services/labDocumentDto";

/** A percentage the AI gave outside 0–100 was not stored; the flag stays until the employee enters a value. */
const CARRIED_FLAG = "PERCENTAGE_OUT_OF_RANGE";
/** Document warning recomputed from the current rows; every other warning describes the AI answer and is kept. */
const COVERAGE_WARNING = "LINE_NOT_EXTRACTED";

const toCheckedRow = (row: LabResult): CheckedRow => ({
  sampleId: row.sampleId,
  layer: row.layer,
  resultLabel: resultLabelSchema.parse(row.resultLabel),
  asbestosType: row.asbestosType,
  percentage: row.percentage,
  percentageRaw: row.percentageRaw,
  sourcePage: row.sourcePage,
  sourceText: row.sourceText,
  labNote: row.labNote,
});

const sameFlags = (first: readonly FlagDto[], second: readonly FlagDto[]) => JSON.stringify(first) === JSON.stringify(second);

/**
 * Brings a document in review up to date after its rows changed (a correction, a decision, an added row or a
 * re-extraction), inside the caller's transaction:
 * - the evidence checks run again on the current values of every row that is not rejected, so a corrected sample ID
 *   loses its "not in the cited line" flag and a wrong correction gains one;
 * - the "result line not cited" warnings are recomputed, so a row added by hand covers the line the AI skipped;
 * - the document is ACCEPTED when it has rows and none is pending, otherwise NEEDS_REVIEW.
 * Confidence is the AI's own statement and is not recomputed.
 */
export async function refreshDocumentReview(tx: Prisma.TransactionClient, documentId: string): Promise<void> {
  const document = await tx.labDocument.findUnique({
    where: { id: documentId },
    select: { status: true, pagesTextJson: true, warningsJson: true },
  });
  if (document === null || !REVIEWABLE_STATUSES.includes(labDocumentStatusSchema.parse(document.status))) return;

  const pages = pagesSchema.parse(JSON.parse(document.pagesTextJson));
  const rows = await tx.labResult.findMany({ where: { labDocumentId: documentId }, orderBy: { createdAt: "asc" } });
  const active = rows.filter((row) => row.reviewStatus !== "REJECTED");
  const checked = checkResultRows(active.map(toCheckedRow), pages);

  for (const [index, row] of active.entries()) {
    const stored = flagsSchema.parse(JSON.parse(row.verificationJson));
    const carried = row.percentage === null ? stored.filter((flag) => flag.code === CARRIED_FLAG) : [];
    const flags = [...checked.rows[index].flags, ...carried];
    if (sameFlags(flags, stored) && checked.rows[index].evidenceVerified === row.evidenceVerified) continue;
    await tx.labResult.update({
      where: { id: row.id },
      data: { verificationJson: JSON.stringify(flags), evidenceVerified: checked.rows[index].evidenceVerified },
    });
  }

  const kept = flagsSchema.parse(JSON.parse(document.warningsJson)).filter((warning) => warning.code !== COVERAGE_WARNING);
  const outcome = documentReviewOutcome(rows.map((row) => ({ reviewStatus: reviewStatusSchema.parse(row.reviewStatus) })));
  await tx.labDocument.update({
    where: { id: documentId },
    data: { status: outcome, warningsJson: JSON.stringify([...checked.warnings, ...kept]) },
  });
}
