import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { layerKey } from "@/domain/matching";
import { normalizeSampleId } from "@/domain/sampleId";
import { NO_TEXT_CODE, NO_TEXT_MESSAGE, redactSecrets, type AiErrorCode } from "@/server/ai/aiErrors";
import { anthropicSender, extractLabReport, type ExtractLabReportDeps, type RunLog } from "@/server/ai/extractLabReport";
import { verifyExtraction, type VerifiedResult } from "@/server/ai/verifyExtraction";
import { getDb } from "@/server/db";
import type { LabDocumentStatus } from "@/server/dbEnums";
import { describeAnthropicKey, getEnv } from "@/server/env";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { extractPages, hasSelectableText, PdfReadError } from "@/server/pdf/extractPages";
import {
  documentInclude,
  LAB_DOCUMENT_ENTITY,
  LAB_REPORT_ID_FIELD,
  pagesSchema,
  toDocumentDtos,
  toRunSummary,
  type AiRunDetail,
  type DocumentRow,
  type LabDocumentDto,
} from "@/server/services/labDocumentDto";
import { refreshDocumentReview } from "@/server/services/labReviewSync";
import { readUpload, saveUpload, sha256Hex } from "@/server/storage/uploads";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** An extraction still EXTRACTING after this long was cut off (server restart); it is shown as failed with Retry. */
export const STALE_EXTRACTION_MS = 10 * 60 * 1000;

const PDF_MAGIC = "%PDF-";

/** One file from a multipart upload. `read` is only called after the size check. */
export type UploadFile = { name: string; type: string; size: number; read: () => Promise<Uint8Array> };

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

/** AI rows the employee has already worked on: accepted, or corrected at least once. Re-extraction keeps them. */
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
   * AI drafts in one transaction; rows the employee accepted or corrected are kept unless replaceReviewed is set, and
   * rows the employee added are never touched.
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
        // A kept row or a row the employee added wins over a new draft of the same sample layer; a rejected one does not.
        const kept = await tx.labResult.findMany({
          where: { labDocumentId: document.id, reviewStatus: { not: "REJECTED" }, OR: [{ id: { in: keptIds } }, { origin: "MANUAL" }] },
          select: { sampleId: true, layer: true },
        });
        const keptKeys = new Set(kept.map((row) => `${normalizeSampleId(row.sampleId)}|${layerKey(row.layer)}`));
        await tx.labResult.deleteMany({ where: { labDocumentId: document.id, origin: "AI", id: { notIn: keptIds } } });
        await tx.labResult.createMany({
          data: verified.results
            .filter((row) => !keptKeys.has(`${normalizeSampleId(row.sampleId)}|${layerKey(row.layer)}`))
            .map((row) => resultData(document.id, outcome.runId, row)),
        });
        // A lab report ID the employee entered wins over the AI's reading, and its "missing" warning no longer applies.
        const enteredId = await tx.correction.findFirst({
          where: { projectId: document.projectId, entity: LAB_DOCUMENT_ENTITY, entityId: document.id, field: LAB_REPORT_ID_FIELD },
          select: { id: true },
        });
        const warnings = enteredId ? verified.warnings.filter((warning) => warning.code !== "LAB_REPORT_ID_MISSING") : verified.warnings;
        await tx.labDocument.update({
          where: { id: document.id },
          data: {
            status: "NEEDS_REVIEW",
            labReportId: enteredId ? undefined : verified.report.labReportId,
            labName: verified.report.labName,
            projectRef: verified.report.projectRef,
            issuedDate: verified.report.issuedDate,
            documentNotesJson: JSON.stringify(verified.notes),
            warningsJson: JSON.stringify(warnings),
            error: null,
            errorCode: null,
            extractionStartedAt: null,
          },
        });
        // Checks the new drafts together with the kept rows and accepts the document if nothing is pending.
        await refreshDocumentReview(tx, document.id);
      });
    } catch (error) {
      console.error(`Lab extraction failed for document ${document.id}: ${redactSecrets(String(error))}`);
      await markFailed(document.id, "UNKNOWN", "The extraction failed unexpectedly. Retry; if it fails again, check the server log.");
    }
  }

  async function toDto(projectId: string, row: DocumentRow): Promise<LabDocumentDto> {
    const [document] = await toDocumentDtos(db, projectId, [row]);
    return document;
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
      return existing ? { fileName, outcome: "duplicate", document: await toDto(projectId, existing) } : null;
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
    return { fileName, outcome: "created", document: await toDto(projectId, created) };
  }

  return {
    async list(projectId: string): Promise<LabDocumentDto[]> {
      await findProject(projectId);
      await expireStale(projectId);
      const rows = await db.labDocument.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, include: documentInclude });
      return toDocumentDtos(db, projectId, rows);
    },

    async get(projectId: string, documentId: string): Promise<LabDocumentDto> {
      await findProject(projectId);
      await expireStale(projectId);
      return toDto(projectId, await loadDocument(projectId, documentId));
    },

    /** The stored PDF, for the source viewer. Uploaded files are immutable (D-020). */
    async getFile(projectId: string, documentId: string): Promise<{ fileName: string; bytes: Uint8Array }> {
      const document = await db.labDocument.findFirst({
        where: { id: documentId, projectId },
        select: { fileName: true, storagePath: true },
      });
      if (document === null) throw new NotFoundError("This lab report does not exist in the project. It may have been deleted.");
      try {
        return { fileName: document.fileName, bytes: await readUpload(deps.storageDir, document.storagePath) };
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          throw new NotFoundError(`The stored PDF of ${document.fileName} is missing from the storage folder.`);
        }
        throw error;
      }
    },

    /** Stores each file once per project. Every file gets its own outcome; one bad file does not stop the others. */
    async upload(projectId: string, files: readonly UploadFile[]): Promise<UploadOutcome[]> {
      await findProject(projectId);
      if (files.length === 0) throw new ValidationError({}, ["Choose at least one PDF file to upload."]);
      const outcomes: UploadOutcome[] = [];
      for (const file of files) outcomes.push(await uploadOne(projectId, file));
      return outcomes;
    },

    /**
     * Retry after a failure, or extract again. Only AI drafts the employee has not accepted or corrected are replaced,
     * unless replaceReviewed is set; rows the employee added stay either way.
     */
    async startExtraction(projectId: string, documentId: string, options: { replaceReviewed: boolean }): Promise<LabDocumentDto> {
      await findProject(projectId);
      await expireStale(projectId);
      const document = await loadDocument(projectId, documentId);
      if (document.status === "EXTRACTING") throw new ConflictError("The extraction of this file is already running.");
      if (document.errorCode === NO_TEXT_CODE) {
        throw new ConflictError(`${NO_TEXT_MESSAGE} Extracting it again cannot help; enter its results manually.`);
      }
      if (!(await claim(documentId, RE_EXTRACTABLE))) {
        throw new ConflictError("The extraction of this file is already running.");
      }
      deps.schedule(() => runExtraction(documentId, options.replaceReviewed));
      return toDto(projectId, await loadDocument(projectId, documentId));
    },

    async getAiRun(projectId: string, runId: string): Promise<AiRunDetail> {
      const run = await db.aiRun.findFirst({ where: { id: runId, projectId } });
      if (run === null) throw new NotFoundError("This AI run does not exist in the project.");
      return { ...toRunSummary(run), responseId: run.responseId, stopReason: run.stopReason, rawResponse: run.rawResponse };
    },
  };
}

export type LabDocumentService = ReturnType<typeof labDocumentService>;
