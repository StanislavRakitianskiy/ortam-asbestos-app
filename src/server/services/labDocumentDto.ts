import type { AiRun, Correction, LabDocument, LabResult, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { ReviewStatus } from "@/domain/labReview";
import { EDITABLE_RESULT_FIELDS, type EditableResultField } from "@/domain/labReviewInput";
import { resultLabelSchema, type ResultLabel } from "@/domain/types";
import { normalizeEvidence } from "@/lib/pdfText";
import { NO_TEXT_CODE } from "@/server/ai/aiErrors";
import type { VerifiedNote } from "@/server/ai/verifyExtraction";
import {
  confidenceSchema,
  labDocumentStatusSchema,
  labResultOriginSchema,
  reviewStatusSchema,
  type Confidence,
  type LabDocumentStatus,
} from "@/server/dbEnums";
import type { PageText } from "@/server/pdf/extractPages";

/**
 * The lab document and lab row shapes the API returns, built from the database rows. Shared by the upload and
 * extraction service and the review service.
 */

export type AiRunSummary = {
  id: string;
  model: string;
  promptVersion: string;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  error: string | null;
  hasRawResponse: boolean;
  createdAt: string;
};

export type AiRunDetail = AiRunSummary & {
  responseId: string | null;
  stopReason: string | null;
  rawResponse: string | null;
};

/** A verification flag or warning as stored: a stable code and a readable message. */
export type FlagDto = { code: string; message: string };

export type FieldValue = string | number | null;

/** One logged employee change to an editable field. */
export type CorrectionDto = {
  id: string;
  field: EditableResultField;
  oldValue: FieldValue;
  newValue: FieldValue;
  reason: string;
  createdAt: string;
};

export type LabResultDto = {
  id: string;
  origin: "AI" | "MANUAL";
  sampleId: string;
  layer: string;
  resultLabel: ResultLabel;
  asbestosType: string | null;
  percentage: number | null;
  percentageRaw: string | null;
  sourcePage: number;
  sourceText: string;
  labNote: string | null;
  confidence: Confidence | null;
  evidenceVerified: boolean;
  flags: FlagDto[];
  reviewStatus: ReviewStatus;
  rejectReason: string | null;
  /** The editable fields as the AI returned them (from aiJson). null for MANUAL rows. */
  aiValues: Partial<Record<EditableResultField, FieldValue>> | null;
  /** Employee changes to the editable fields, oldest first. */
  corrections: CorrectionDto[];
  /** Why the employee added the row. MANUAL rows only. */
  addedReason: string | null;
};

export type LabDocumentDto = {
  id: string;
  projectId: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  pageCount: number;
  status: LabDocumentStatus;
  error: string | null;
  errorCode: string | null;
  /** True when Retry can help (every failure except a PDF without text). */
  retryable: boolean;
  labReportId: string | null;
  /** Set when the employee entered or corrected the lab report ID (the latest entry); a new extraction keeps it. */
  labReportIdEntered: { reason: string; createdAt: string } | null;
  labName: string | null;
  projectRef: string | null;
  issuedDate: string | null;
  notes: VerifiedNote[];
  warnings: FlagDto[];
  /** Result rows. Empty unless the status is NEEDS_REVIEW or ACCEPTED: a failed or running step shows none. */
  results: LabResultDto[];
  /** The run that produced the current AI rows. */
  extractedBy: AiRunSummary | null;
  /** The most recent extraction call, successful or not. */
  lastRun: AiRunSummary | null;
  createdAt: string;
  updatedAt: string;
};

/** Correction.field of the log entry written when the employee adds a row by hand. */
export const MANUAL_ROW_FIELD = "row";
/** Correction.entity and field of a lab report ID entered by the employee. */
export const LAB_DOCUMENT_ENTITY = "LabDocument";
export const LAB_REPORT_ID_FIELD = "labReportId";

export const pagesSchema = z.array(z.object({ page: z.int().positive(), lines: z.array(z.string()) }));
export const flagsSchema = z.array(z.object({ code: z.string(), message: z.string() }));
const notesSchema = z.array(
  z.object({ page: z.int(), text: z.string(), relatedSampleIds: z.array(z.string()), verified: z.boolean() }),
);

/** The editable fields of a stored aiJson row. Values of an unexpected type are left out rather than guessed. */
const aiValuesSchema = z.object({
  sampleId: z.string().optional().catch(undefined),
  layer: z.string().optional().catch(undefined),
  resultLabel: z
    .string()
    .transform((value) => value.trim().toUpperCase())
    .optional()
    .catch(undefined),
  asbestosType: z.string().nullable().optional().catch(undefined),
  percentage: z.number().nullable().optional().catch(undefined),
  labNote: z.string().nullable().optional().catch(undefined),
});

/** Document statuses whose rows are shown and can be reviewed. */
export const REVIEWABLE_STATUSES: readonly LabDocumentStatus[] = ["NEEDS_REVIEW", "ACCEPTED"];

export function toRunSummary(run: AiRun): AiRunSummary {
  return {
    id: run.id,
    model: run.model,
    promptVersion: run.promptVersion,
    status: run.status,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    durationMs: run.durationMs,
    error: run.error,
    hasRawResponse: run.rawResponse !== null,
    createdAt: run.createdAt.toISOString(),
  };
}

/** Position of the cited line in the document, so rows are listed in the order the lab printed them. */
function documentOrder(pages: readonly PageText[], row: Pick<LabResult, "sourcePage" | "sourceText">): number {
  const page = pages.find((candidate) => candidate.page === row.sourcePage);
  const quote = normalizeEvidence(row.sourceText);
  const index = page?.lines.findIndex((line) => normalizeEvidence(line).includes(quote)) ?? -1;
  return row.sourcePage * 100_000 + (index === -1 ? 99_999 : index);
}

const decodeValue = (value: string | null): FieldValue => (value === null ? null : (JSON.parse(value) as FieldValue));

function parseAiValues(aiJson: string | null): LabResultDto["aiValues"] {
  if (aiJson === null) return null;
  try {
    const values = aiValuesSchema.parse(JSON.parse(aiJson));
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
  } catch {
    return {};
  }
}

const isEditableField = (field: string): field is EditableResultField =>
  (EDITABLE_RESULT_FIELDS as readonly string[]).includes(field);

function toResultDto(row: LabResult, corrections: readonly Correction[]): LabResultDto {
  return {
    id: row.id,
    origin: labResultOriginSchema.parse(row.origin),
    sampleId: row.sampleId,
    layer: row.layer,
    resultLabel: resultLabelSchema.parse(row.resultLabel),
    asbestosType: row.asbestosType,
    percentage: row.percentage,
    percentageRaw: row.percentageRaw,
    sourcePage: row.sourcePage,
    sourceText: row.sourceText,
    labNote: row.labNote,
    confidence: row.confidence === null ? null : confidenceSchema.parse(row.confidence),
    evidenceVerified: row.evidenceVerified,
    flags: flagsSchema.parse(JSON.parse(row.verificationJson)),
    reviewStatus: reviewStatusSchema.parse(row.reviewStatus),
    rejectReason: row.rejectReason,
    aiValues: parseAiValues(row.aiJson),
    corrections: corrections.flatMap((correction) =>
      isEditableField(correction.field)
        ? [
            {
              id: correction.id,
              field: correction.field,
              oldValue: decodeValue(correction.oldValue),
              newValue: decodeValue(correction.newValue),
              reason: correction.reason,
              createdAt: correction.createdAt.toISOString(),
            },
          ]
        : [],
    ),
    addedReason: corrections.find((correction) => correction.field === MANUAL_ROW_FIELD)?.reason ?? null,
  };
}

export type DocumentRow = LabDocument & { results: LabResult[]; aiRuns: AiRun[] };

export const documentInclude = {
  results: true,
  aiRuns: { where: { kind: "EXTRACTION" } },
} satisfies Prisma.LabDocumentInclude;

/** Correction log entries by lab row ID (or by document ID for lab report IDs), oldest first. */
export type CorrectionsByResult = ReadonlyMap<string, readonly Correction[]>;

export function toDocumentDto(
  row: DocumentRow,
  corrections: CorrectionsByResult = new Map(),
  documentCorrections: readonly Correction[] = [],
): LabDocumentDto {
  const status = labDocumentStatusSchema.parse(row.status);
  const pages = pagesSchema.parse(JSON.parse(row.pagesTextJson));
  const showResults = REVIEWABLE_STATUSES.includes(status);
  const results = showResults
    ? [...row.results]
        .sort((first, second) => documentOrder(pages, first) - documentOrder(pages, second))
        .map((result) => toResultDto(result, corrections.get(result.id) ?? []))
    : [];
  const runs = [...row.aiRuns].sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());
  // Rows kept through a re-extraction still point at the older run; the newest run with rows produced the draft.
  const producingRun = showResults ? runs.find((run) => row.results.some((result) => result.aiRunId === run.id)) : undefined;
  return {
    id: row.id,
    projectId: row.projectId,
    fileName: row.fileName,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    status,
    error: status === "FAILED" ? row.error : null,
    errorCode: status === "FAILED" ? row.errorCode : null,
    retryable: status === "FAILED" && row.errorCode !== NO_TEXT_CODE,
    labReportId: row.labReportId,
    labReportIdEntered: latestEntry(documentCorrections),
    labName: row.labName,
    projectRef: row.projectRef,
    issuedDate: row.issuedDate,
    notes: showResults ? notesSchema.parse(JSON.parse(row.documentNotesJson)) : [],
    warnings: showResults ? flagsSchema.parse(JSON.parse(row.warningsJson)) : [],
    results,
    extractedBy: producingRun ? toRunSummary(producingRun) : null,
    lastRun: runs[0] ? toRunSummary(runs[0]) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function latestEntry(corrections: readonly Correction[]): LabDocumentDto["labReportIdEntered"] {
  const latest = corrections.at(-1);
  return latest ? { reason: latest.reason, createdAt: latest.createdAt.toISOString() } : null;
}

type Reader = Pick<PrismaClient, "correction"> | Pick<Prisma.TransactionClient, "correction">;

/** The correction log of the given lab rows (or documents, with entity LabDocument), grouped by row. */
export async function loadCorrections(
  db: Reader,
  projectId: string,
  ids: readonly string[],
  entity: "LabResult" | typeof LAB_DOCUMENT_ENTITY = "LabResult",
): Promise<CorrectionsByResult> {
  const rows = await db.correction.findMany({
    where: { projectId, entity, entityId: { in: [...ids] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const grouped = new Map<string, Correction[]>();
  for (const row of rows) {
    const list = grouped.get(row.entityId) ?? [];
    list.push(row);
    grouped.set(row.entityId, list);
  }
  return grouped;
}

/** Document rows with their correction log, as the API returns them. */
export async function toDocumentDtos(db: Reader, projectId: string, rows: readonly DocumentRow[]): Promise<LabDocumentDto[]> {
  const corrections = await loadCorrections(
    db,
    projectId,
    rows.flatMap((row) => row.results.map((result) => result.id)),
  );
  const documentCorrections = await loadCorrections(
    db,
    projectId,
    rows.map((row) => row.id),
    LAB_DOCUMENT_ENTITY,
  );
  return rows.map((row) =>
    toDocumentDto(
      row,
      corrections,
      (documentCorrections.get(row.id) ?? []).filter((correction) => correction.field === LAB_REPORT_ID_FIELD),
    ),
  );
}
