import path from "node:path";
import { Prisma, type AiRun, type LabDocument, type LabResult, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { layerKey } from "@/domain/matching";
import { normalizeSampleId } from "@/domain/sampleId";
import { resultLabelSchema, type ResultLabel } from "@/domain/types";
import { NO_TEXT_CODE, NO_TEXT_MESSAGE, redactSecrets, type AiErrorCode } from "@/server/ai/aiErrors";
import { anthropicSender, extractLabReport, type ExtractLabReportDeps, type RunLog } from "@/server/ai/extractLabReport";
import { normalizeEvidence, verifyExtraction, type VerifiedNote, type VerifiedResult } from "@/server/ai/verifyExtraction";
import { getDb } from "@/server/db";
import {
  confidenceSchema,
  labDocumentStatusSchema,
  labResultOriginSchema,
  reviewStatusSchema,
  type Confidence,
  type LabDocumentStatus,
} from "@/server/dbEnums";
import { describeAnthropicKey, getEnv } from "@/server/env";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { extractPages, hasSelectableText, PdfReadError, type PageText } from "@/server/pdf/extractPages";
import { saveUpload, sha256Hex } from "@/server/storage/uploads";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** An extraction still EXTRACTING after this long was cut off (server restart); it is shown as failed with Retry. */
export const STALE_EXTRACTION_MS = 10 * 60 * 1000;

const PDF_MAGIC = "%PDF-";

/** 409 code: re-extraction would replace rows the employee reviewed, so it needs confirmation. */
export const REVIEWED_RESULTS_CONFLICT = "REVIEWED_RESULTS";

/** One file from a multipart upload. `read` is only called after the size check. */
export type UploadFile = { name: string; type: string; size: number; read: () => Promise<Uint8Array> };

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

export type LabResultDto = {
  id: string;
  origin: string;
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
  reviewStatus: string;
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
  labName: string | null;
  projectRef: string | null;
  issuedDate: string | null;
  notes: VerifiedNote[];
  warnings: FlagDto[];
  /** AI draft rows. Empty unless the status is NEEDS_REVIEW or ACCEPTED: a failed or running step shows none. */
  results: LabResultDto[];
  /** The run that produced the current results. */
  extractedBy: AiRunSummary | null;
  /** The most recent extraction call, successful or not. */
  lastRun: AiRunSummary | null;
  createdAt: string;
  updatedAt: string;
};

export type UploadOutcome =
  | { fileName: string; outcome: "created"; document: LabDocumentDto }
  | { fileName: string; outcome: "duplicate"; document: LabDocumentDto }
  | { fileName: string; outcome: "rejected"; error: string };

export type LabDocumentDeps = {
  db: PrismaClient;
  storageDir: string;
  /** Model, key status and transport for a real call. Read at call time so .env.local changes need only a restart. */
  extraction: () => Omit<ExtractLabReportDeps, "runLog">;
  /** Runs work after the HTTP response (next/server `after` in route handlers). */
  schedule: (task: () => Promise<void>) => void;
  now: () => Date;
};

const pagesSchema = z.array(z.object({ page: z.int().positive(), lines: z.array(z.string()) }));
const flagsSchema = z.array(z.object({ code: z.string(), message: z.string() }));
const notesSchema = z.array(
  z.object({ page: z.int(), text: z.string(), relatedSampleIds: z.array(z.string()), verified: z.boolean() }),
);

const RESULT_STATUSES: readonly LabDocumentStatus[] = ["NEEDS_REVIEW", "ACCEPTED"];
const RE_EXTRACTABLE: LabDocumentStatus[] = ["UPLOADED", "NEEDS_REVIEW", "ACCEPTED", "FAILED"];

/** The real Anthropic call configured from .env.local. Tests replace it; the app never does. */
function realExtraction(): Omit<ExtractLabReportDeps, "runLog"> {
  const env = getEnv();
  return { model: env.ANTHROPIC_MODEL, keyStatus: describeAnthropicKey(env), send: anthropicSender(env.ANTHROPIC_API_KEY ?? "") };
}

function resolveDeps(overrides: Partial<LabDocumentDeps>): LabDocumentDeps {
  return {
    db: overrides.db ?? getDb(),
    storageDir: overrides.storageDir ?? getEnv().STORAGE_DIR,
    extraction: overrides.extraction ?? realExtraction,
    schedule:
      overrides.schedule ??
      ((task) => {
        void task();
      }),
    now: overrides.now ?? (() => new Date()),
  };
}

/** Keeps the base name only, without control characters, at most 200 characters. */
function cleanFileName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (base === "" ? "upload.pdf" : base).slice(0, 200);
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

function toRunSummary(run: AiRun): AiRunSummary {
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

function toResultDto(row: LabResult): LabResultDto {
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
  };
}

type DocumentRow = LabDocument & { results: LabResult[]; aiRuns: AiRun[] };

function toDocumentDto(row: DocumentRow): LabDocumentDto {
  const status = labDocumentStatusSchema.parse(row.status);
  const pages = pagesSchema.parse(JSON.parse(row.pagesTextJson));
  const showResults = RESULT_STATUSES.includes(status);
  const results = showResults
    ? [...row.results].sort((first, second) => documentOrder(pages, first) - documentOrder(pages, second)).map(toResultDto)
    : [];
  const runs = [...row.aiRuns].sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());
  const producingRunId = row.results.find((result) => result.aiRunId !== null)?.aiRunId ?? null;
  const producingRun = showResults ? runs.find((run) => run.id === producingRunId) : undefined;
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

const documentInclude = {
  results: true,
  aiRuns: { where: { kind: "EXTRACTION" } },
} satisfies Prisma.LabDocumentInclude;

function prismaRunLog(db: PrismaClient, projectId: string, labDocumentId: string): RunLog {
  return {
    async start(meta) {
      const run = await db.aiRun.create({
        data: { projectId, labDocumentId, kind: "EXTRACTION", status: "RUNNING", durationMs: 0, ...meta },
      });
      return run.id;
    },
    async finish(runId, record) {
      await db.aiRun.update({ where: { id: runId }, data: record });
    },
  };
}

/** Rows the employee has already worked on: accepted, or corrected at least once. */
async function reviewedResultIds(tx: Prisma.TransactionClient, projectId: string, labDocumentId: string): Promise<string[]> {
  const rows = await tx.labResult.findMany({ where: { labDocumentId }, select: { id: true, reviewStatus: true, origin: true } });
  const corrected = await tx.correction.findMany({
    where: { projectId, entity: "LabResult", entityId: { in: rows.map((row) => row.id) } },
    select: { entityId: true },
  });
  const correctedIds = new Set(corrected.map((correction) => correction.entityId));
  return rows
    .filter((row) => row.origin === "AI" && (row.reviewStatus === "ACCEPTED" || correctedIds.has(row.id)))
    .map((row) => row.id);
}

function resultData(labDocumentId: string, aiRunId: string, row: VerifiedResult): Prisma.LabResultCreateManyInput {
  return {
    labDocumentId,
    aiRunId,
    origin: "AI",
    aiJson: row.aiJson,
    sampleId: row.sampleId,
    layer: row.layer,
    resultLabel: row.resultLabel,
    asbestosType: row.asbestosType,
    percentage: row.percentage,
    percentageRaw: row.percentageRaw,
    sourcePage: row.sourcePage,
    sourceText: row.sourceText,
    labNote: row.labNote,
    confidence: row.confidence,
    evidenceVerified: row.evidenceVerified,
    verificationJson: JSON.stringify(row.flags),
    reviewStatus: "PENDING",
  };
}

/**
 * Lab report PDFs of a project: immutable upload with SHA-256 de-duplication, page text, AI extraction and its
 * deterministic verification. The AI result is a draft for the employee to review.
 */
export function labDocumentService(overrides: Partial<LabDocumentDeps> = {}) {
  const deps = resolveDeps(overrides);
  const { db } = deps;

  async function findProject(projectId: string) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, code: true } });
    if (project === null) throw new NotFoundError("This project does not exist. It may have been deleted.");
    return project;
  }

  async function loadDocument(projectId: string, documentId: string): Promise<DocumentRow> {
    const row = await db.labDocument.findFirst({ where: { id: documentId, projectId }, include: documentInclude });
    if (row === null) throw new NotFoundError("This lab report does not exist in the project. It may have been deleted.");
    return row;
  }

  /** An extraction cut off by a server restart would otherwise spin forever. */
  async function expireStale(projectId: string) {
    const cutoff = new Date(deps.now().getTime() - STALE_EXTRACTION_MS);
    const stale = await db.labDocument.findMany({
      where: { projectId, status: "EXTRACTING", extractionStartedAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const { id } of stale) {
      await markFailed(id, "INTERRUPTED", "The extraction was interrupted (the server stopped or the AI call never finished). Retry.");
      await db.aiRun.updateMany({
        where: { labDocumentId: id, status: "RUNNING" },
        data: { status: "FAILED", error: "Interrupted before the call finished." },
      });
    }
  }

  async function markFailed(documentId: string, code: AiErrorCode, message: string) {
    await db.labDocument.updateMany({
      where: { id: documentId, status: "EXTRACTING" },
      data: { status: "FAILED", error: message, errorCode: code, extractionStartedAt: null },
    });
  }

  /** Moves the document to EXTRACTING unless another extraction holds it. */
  async function claim(documentId: string, from: LabDocumentStatus[]): Promise<boolean> {
    const { count } = await db.labDocument.updateMany({
      where: { id: documentId, status: { in: from }, OR: [{ errorCode: null }, { errorCode: { not: NO_TEXT_CODE } }] },
      data: { status: "EXTRACTING", extractionStartedAt: deps.now(), error: null, errorCode: null },
    });
    return count === 1;
  }

  /**
   * Calls the AI for a claimed document and stores the verified rows. Re-extraction replaces the document's earlier
   * AI rows in one transaction; rows the employee accepted or corrected are kept unless replaceReviewed is set.
   */
  async function runExtraction(documentId: string, replaceReviewed: boolean): Promise<void> {
    const document = await db.labDocument.findUnique({ where: { id: documentId }, include: { project: { select: { code: true } } } });
    if (document === null || document.status !== "EXTRACTING") return;
    const pages = pagesSchema.parse(JSON.parse(document.pagesTextJson));
    try {
      const outcome = await extractLabReport(pages, {
        ...deps.extraction(),
        runLog: prismaRunLog(db, document.projectId, document.id),
      });
      if (!outcome.ok) {
        await markFailed(document.id, outcome.failure.code, outcome.failure.message);
        return;
      }
      const verified = verifyExtraction(outcome.extraction, { pages, projectCode: document.project.code });
      await db.$transaction(async (tx) => {
        const current = await tx.labDocument.findUnique({ where: { id: document.id }, select: { status: true } });
        if (current?.status !== "EXTRACTING") return;
        const keptIds = replaceReviewed ? [] : await reviewedResultIds(tx, document.projectId, document.id);
        const kept = await tx.labResult.findMany({ where: { id: { in: keptIds } }, select: { sampleId: true, layer: true } });
        const keptKeys = new Set(kept.map((row) => `${normalizeSampleId(row.sampleId)}|${layerKey(row.layer)}`));
        await tx.labResult.deleteMany({ where: { labDocumentId: document.id, origin: "AI", id: { notIn: keptIds } } });
        await tx.labResult.createMany({
          data: verified.results
            // A kept (reviewed) row wins over a new draft of the same sample layer.
            .filter((row) => !keptKeys.has(`${normalizeSampleId(row.sampleId)}|${layerKey(row.layer)}`))
            .map((row) => resultData(document.id, outcome.runId, row)),
        });
        await tx.labDocument.update({
          where: { id: document.id },
          data: {
            status: "NEEDS_REVIEW",
            labReportId: verified.report.labReportId,
            labName: verified.report.labName,
            projectRef: verified.report.projectRef,
            issuedDate: verified.report.issuedDate,
            documentNotesJson: JSON.stringify(verified.notes),
            warningsJson: JSON.stringify(verified.warnings),
            error: null,
            errorCode: null,
            extractionStartedAt: null,
          },
        });
      });
    } catch (error) {
      console.error(`Lab extraction failed for document ${document.id}: ${redactSecrets(String(error))}`);
      await markFailed(document.id, "UNKNOWN", "The extraction failed unexpectedly. Retry; if it fails again, check the server log.");
    }
  }

  async function uploadOne(projectId: string, file: UploadFile): Promise<UploadOutcome> {
    const fileName = cleanFileName(file.name);
    const reject = (error: string): UploadOutcome => ({ fileName, outcome: "rejected", error: `${fileName} ${error}` });
    if (file.type !== "application/pdf") return reject("is not a PDF. Only application/pdf files are accepted.");
    if (file.size === 0) return reject("is empty.");
    if (file.size > MAX_UPLOAD_BYTES) return reject(`is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
    const bytes = await file.read();
    if (new TextDecoder().decode(bytes.subarray(0, PDF_MAGIC.length)) !== PDF_MAGIC) {
      return reject("is not a PDF file (its content does not start with %PDF-).");
    }

    const sha256 = sha256Hex(bytes);
    const duplicate = async (): Promise<UploadOutcome | null> => {
      const existing = await db.labDocument.findUnique({
        where: { projectId_sha256: { projectId, sha256 } },
        include: documentInclude,
      });
      return existing ? { fileName, outcome: "duplicate", document: toDocumentDto(existing) } : null;
    };
    const earlier = await duplicate();
    if (earlier) return earlier;

    let pdf;
    try {
      pdf = await extractPages(bytes);
    } catch (error) {
      if (error instanceof PdfReadError) return reject(`cannot be read: ${error.message}`);
      throw error;
    }
    const storagePath = await saveUpload(deps.storageDir, bytes, sha256);
    const readable = hasSelectableText(pdf);
    let created;
    try {
      created = await db.labDocument.create({
        data: {
          projectId,
          fileName,
          sha256,
          storagePath,
          sizeBytes: bytes.byteLength,
          pageCount: pdf.pageCount,
          pagesTextJson: JSON.stringify(pdf.pages),
          status: readable ? "UPLOADED" : "FAILED",
          error: readable ? null : NO_TEXT_MESSAGE,
          errorCode: readable ? null : NO_TEXT_CODE,
        },
        include: documentInclude,
      });
    } catch (error) {
      // The same file uploaded twice at the same moment: the unique index lets only one row in.
      if (isUniqueViolation(error)) {
        const other = await duplicate();
        if (other) return other;
      }
      throw error;
    }
    if (readable) {
      deps.schedule(async () => {
        if (await claim(created.id, ["UPLOADED"])) await runExtraction(created.id, false);
      });
    }
    return { fileName, outcome: "created", document: toDocumentDto(created) };
  }

  return {
    async list(projectId: string): Promise<LabDocumentDto[]> {
      await findProject(projectId);
      await expireStale(projectId);
      const rows = await db.labDocument.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, include: documentInclude });
      return rows.map(toDocumentDto);
    },

    async get(projectId: string, documentId: string): Promise<LabDocumentDto> {
      await findProject(projectId);
      await expireStale(projectId);
      return toDocumentDto(await loadDocument(projectId, documentId));
    },

    /** Stores each file once per project. Every file gets its own outcome; one bad file does not stop the others. */
    async upload(projectId: string, files: readonly UploadFile[]): Promise<UploadOutcome[]> {
      await findProject(projectId);
      if (files.length === 0) throw new ValidationError({}, ["Choose at least one PDF file to upload."]);
      const outcomes: UploadOutcome[] = [];
      for (const file of files) outcomes.push(await uploadOne(projectId, file));
      return outcomes;
    },

    /** Retry after a failure, or extract again. Rows the employee reviewed are only replaced with replaceReviewed. */
    async startExtraction(projectId: string, documentId: string, options: { replaceReviewed: boolean }): Promise<LabDocumentDto> {
      await findProject(projectId);
      await expireStale(projectId);
      const document = await loadDocument(projectId, documentId);
      if (document.status === "EXTRACTING") throw new ConflictError("The extraction of this file is already running.");
      if (document.errorCode === NO_TEXT_CODE) {
        throw new ConflictError(`${NO_TEXT_MESSAGE} Extracting it again cannot help; enter its results manually.`);
      }
      if (!options.replaceReviewed) {
        const reviewed = await db.$transaction((tx) => reviewedResultIds(tx, projectId, documentId));
        if (reviewed.length > 0) {
          throw new ConflictError(
            `${reviewed.length} result(s) of this file were already accepted or corrected. Confirm that a new extraction may replace them.`,
            REVIEWED_RESULTS_CONFLICT,
          );
        }
      }
      if (!(await claim(documentId, RE_EXTRACTABLE))) {
        throw new ConflictError("The extraction of this file is already running.");
      }
      deps.schedule(() => runExtraction(documentId, options.replaceReviewed));
      return toDocumentDto(await loadDocument(projectId, documentId));
    },

    async getAiRun(projectId: string, runId: string): Promise<AiRunDetail> {
      const run = await db.aiRun.findFirst({ where: { id: runId, projectId } });
      if (run === null) throw new NotFoundError("This AI run does not exist in the project.");
      return { ...toRunSummary(run), responseId: run.responseId, stopReason: run.stopReason, rawResponse: run.rawResponse };
    },
  };
}

export type LabDocumentService = ReturnType<typeof labDocumentService>;
