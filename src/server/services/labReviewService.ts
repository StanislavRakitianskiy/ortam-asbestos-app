import type { LabResult, Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { isBulkAcceptable } from "@/domain/labReview";
import {
  EDITABLE_RESULT_FIELDS,
  labReportIdInputSchema,
  labResultCorrectionSchema,
  labResultDecisionSchema,
  manualLabResultSchema,
  type EditableResultField,
} from "@/domain/labReviewInput";
import { acceptedLabResultSchema, type AcceptedLabResult } from "@/domain/types";
import { getDb } from "@/server/db";
import { confidenceSchema, labDocumentStatusSchema, reviewStatusSchema } from "@/server/dbEnums";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  documentInclude,
  flagsSchema,
  LAB_DOCUMENT_ENTITY,
  LAB_REPORT_ID_FIELD,
  MANUAL_ROW_FIELD,
  REVIEWABLE_STATUSES,
  toDocumentDtos,
  type FieldValue,
  type LabDocumentDto,
} from "@/server/services/labDocumentDto";
import { refreshDocumentReview } from "@/server/services/labReviewSync";

type Tx = Prisma.TransactionClient;
type ReviewedDocument = { id: string; fileName: string; pageCount: number };

export type BulkAcceptOutcome = { accepted: number; document: LabDocumentDto };

/** The service parses again what the route handler already validated, so a direct call cannot skip a rule. */
function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw ValidationError.fromZod(result.error);
  return result.data;
}

/** Correction.oldValue / newValue: JSON-encoded, null when absent. */
const encode = (value: FieldValue): string | null => (value === null ? null : JSON.stringify(value));

/** Why a row cannot be accepted as it is, or null. The report needs a sample, a layer and a usable source reference. */
function acceptBlocker(row: Pick<LabResult, "sampleId" | "layer" | "sourcePage" | "sourceText">, pageCount: number): string | null {
  if (row.sampleId.trim() === "") return "Enter the sample ID before accepting this row.";
  if (row.layer.trim() === "") return "Enter the layer before accepting this row.";
  if (row.sourceText.trim() === "" || row.sourcePage < 1 || row.sourcePage > pageCount) {
    return "This row has no usable source reference (an existing page and a quoted line). Reject it and add the row by hand with its page and quote.";
  }
  return null;
}

function assertAcceptable(row: Pick<LabResult, "sampleId" | "layer" | "sourcePage" | "sourceText">, pageCount: number) {
  const blocker = acceptBlocker(row, pageCount);
  if (blocker !== null) throw new ConflictError(blocker);
}

/**
 * The employee's review of extracted lab rows: corrections (the AI original in aiJson is never changed and every
 * change is logged with a reason), accept and reject decisions, bulk acceptance of verified rows and rows added by
 * hand. Only accepted rows of fully reviewed documents leave this service for matching and the report.
 */
export function labReviewService(db: PrismaClient = getDb()) {
  /**
   * Applies one review change in a transaction: checks that the document can be reviewed, runs the change, re-checks
   * the rows against the PDF text, updates the document status and moves Project.updatedAt.
   */
  async function change(projectId: string, documentId: string, apply: (tx: Tx, document: ReviewedDocument) => Promise<void>) {
    const row = await db.$transaction(async (tx) => {
      const document = await tx.labDocument.findFirst({
        where: { id: documentId, projectId },
        select: { id: true, status: true, fileName: true, pageCount: true },
      });
      if (document === null) throw new NotFoundError("This lab report does not exist in the project. It may have been deleted.");
      const status = labDocumentStatusSchema.parse(document.status);
      if (status === "FAILED") {
        throw new ConflictError(`The extraction of ${document.fileName} failed, so it has no results to review. Retry it on the Lab reports tab.`);
      }
      if (!REVIEWABLE_STATUSES.includes(status)) {
        throw new ConflictError(`${document.fileName} is being extracted. Review its results when the extraction has finished.`);
      }
      await apply(tx, document);
      await refreshDocumentReview(tx, document.id);
      await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
      return tx.labDocument.findUniqueOrThrow({ where: { id: document.id }, include: documentInclude });
    });
    const [dto] = await toDocumentDtos(db, projectId, [row]);
    return dto;
  }

  async function findResult(tx: Tx, documentId: string, resultId: string): Promise<LabResult> {
    const row = await tx.labResult.findFirst({ where: { id: resultId, labDocumentId: documentId } });
    if (row === null) {
      throw new NotFoundError("This result row does not exist in the lab report. A new extraction may have replaced it; reload the page.");
    }
    return row;
  }

  return {
    /**
     * Changes the current values of a row and logs one Correction per changed field with the reason. aiJson keeps the
     * AI original. The corrected row goes back to pending unless `accept` is set, so what is used was accepted as is.
     */
    async correct(projectId: string, documentId: string, resultId: string, input: unknown): Promise<LabDocumentDto> {
      const { changes, reason, accept } = parseInput(labResultCorrectionSchema, input);
      return change(projectId, documentId, async (tx, document) => {
        const row = await findResult(tx, documentId, resultId);
        const changed = EDITABLE_RESULT_FIELDS.flatMap((field) => {
          const next = changes[field];
          return next === undefined || next === row[field] ? [] : [{ field, previous: row[field] as FieldValue, next }];
        });
        if (changed.length === 0) throw new ValidationError({}, ["Nothing changed: the new values are the same as the current ones."]);

        // Each value was parsed by its own field schema, so it has that column's type.
        const updates = Object.fromEntries(changed.map(({ field, next }) => [field, next])) as Partial<
          Pick<LabResult, EditableResultField>
        >;
        if (accept) assertAcceptable({ ...row, ...updates }, document.pageCount);
        await tx.labResult.update({
          where: { id: row.id },
          data: { ...updates, reviewStatus: accept ? "ACCEPTED" : "PENDING", rejectReason: null },
        });
        await tx.correction.createMany({
          data: changed.map(({ field, previous, next }) => ({
            projectId,
            entity: "LabResult",
            entityId: row.id,
            field,
            oldValue: encode(previous),
            newValue: encode(next),
            reason,
          })),
        });
      });
    },

    /** Accept, reject (with a reason) or reopen one row. */
    async decide(projectId: string, documentId: string, resultId: string, input: unknown): Promise<LabDocumentDto> {
      const decision = parseInput(labResultDecisionSchema, input);
      return change(projectId, documentId, async (tx, document) => {
        const row = await findResult(tx, documentId, resultId);
        if (decision.decision === "ACCEPT") assertAcceptable(row, document.pageCount);
        await tx.labResult.update({
          where: { id: row.id },
          data:
            decision.decision === "ACCEPT"
              ? { reviewStatus: "ACCEPTED", rejectReason: null }
              : decision.decision === "REJECT"
                ? { reviewStatus: "REJECTED", rejectReason: decision.reason }
                : { reviewStatus: "PENDING", rejectReason: null },
        });
      });
    },

    /** Accepts every pending row whose evidence is verified, whose confidence is not low and that has no open flag. */
    async acceptVerified(projectId: string, documentId: string): Promise<BulkAcceptOutcome> {
      let accepted = 0;
      const document = await change(projectId, documentId, async (tx, reviewed) => {
        const pending = await tx.labResult.findMany({ where: { labDocumentId: documentId, reviewStatus: "PENDING" } });
        const ids = pending
          .filter((row) =>
            isBulkAcceptable({
              reviewStatus: reviewStatusSchema.parse(row.reviewStatus),
              evidenceVerified: row.evidenceVerified,
              confidence: row.confidence === null ? null : confidenceSchema.parse(row.confidence),
              flags: flagsSchema.parse(JSON.parse(row.verificationJson)),
            }),
          )
          .filter((row) => acceptBlocker(row, reviewed.pageCount) === null)
          .map((row) => row.id);
        ({ count: accepted } = await tx.labResult.updateMany({
          where: { id: { in: ids }, reviewStatus: "PENDING" },
          data: { reviewStatus: "ACCEPTED", rejectReason: null },
        }));
      });
      return { accepted, document };
    },

    /**
     * Adds a row the AI missed. It needs the page and the line as printed; the quote is checked against the PDF text
     * like an AI row. The row starts pending and the addition is logged with its reason.
     */
    async addManual(projectId: string, documentId: string, input: unknown): Promise<LabDocumentDto> {
      const { reason, ...values } = parseInput(manualLabResultSchema, input);
      return change(projectId, documentId, async (tx, document) => {
        if (values.sourcePage > document.pageCount) {
          throw ValidationError.field("sourcePage", `must be between 1 and ${document.pageCount}`);
        }
        const row = await tx.labResult.create({
          data: {
            labDocumentId: documentId,
            origin: "MANUAL",
            aiRunId: null,
            aiJson: null,
            confidence: null,
            percentageRaw: null,
            ...values,
            reviewStatus: "PENDING",
          },
        });
        await tx.correction.create({
          data: {
            projectId,
            entity: "LabResult",
            entityId: row.id,
            field: MANUAL_ROW_FIELD,
            oldValue: null,
            newValue: JSON.stringify(values),
            reason,
          },
        });
      });
    },

    /**
     * Enters or corrects the lab report ID of a document, with a reason, logged as a LabDocument correction. A later
     * extraction keeps it. The "no lab report ID" warning no longer applies once an ID is entered.
     */
    async setLabReportId(projectId: string, documentId: string, input: unknown): Promise<LabDocumentDto> {
      const { labReportId, reason } = parseInput(labReportIdInputSchema, input);
      return change(projectId, documentId, async (tx) => {
        const current = await tx.labDocument.findUniqueOrThrow({
          where: { id: documentId },
          select: { labReportId: true, warningsJson: true },
        });
        if (current.labReportId === labReportId) {
          throw new ValidationError({}, ["Nothing changed: this is already the lab report ID."]);
        }
        const warnings = flagsSchema.parse(JSON.parse(current.warningsJson)).filter((warning) => warning.code !== "LAB_REPORT_ID_MISSING");
        await tx.labDocument.update({ where: { id: documentId }, data: { labReportId, warningsJson: JSON.stringify(warnings) } });
        await tx.correction.create({
          data: {
            projectId,
            entity: LAB_DOCUMENT_ENTITY,
            entityId: documentId,
            field: LAB_REPORT_ID_FIELD,
            oldValue: encode(current.labReportId),
            newValue: encode(labReportId),
            reason,
          },
        });
      });
    },

    /**
     * The lab rows matching and the report may use: accepted rows of documents whose every row was accepted or rejected.
     * A partly reviewed document contributes nothing, so a not-detected layer can never stand in for a pending one.
     */
    async acceptedResults(projectId: string): Promise<AcceptedLabResult[]> {
      const rows = await db.labResult.findMany({
        where: { reviewStatus: "ACCEPTED", labDocument: { projectId, status: "ACCEPTED" } },
        include: { labDocument: { select: { id: true, fileName: true, labReportId: true } } },
        orderBy: [{ labDocument: { createdAt: "asc" } }, { createdAt: "asc" }],
      });
      return rows.map((row) =>
        acceptedLabResultSchema.parse({
          id: row.id,
          documentId: row.labDocument.id,
          // A report without an ID (none extracted or entered) is identified by its file name (warning LAB_REPORT_ID_MISSING).
          labReportId: row.labDocument.labReportId?.trim() || row.labDocument.fileName,
          fileName: row.labDocument.fileName,
          page: row.sourcePage,
          sourceText: row.sourceText,
          sampleId: row.sampleId,
          layer: row.layer,
          resultLabel: row.resultLabel,
          asbestosType: row.asbestosType,
          percentage: row.percentage,
          percentageRaw: row.percentageRaw,
          labNote: row.labNote,
        }),
      );
    },
  };
}

export type LabReviewService = ReturnType<typeof labReviewService>;
