import { Prisma, type PrismaClient } from "@prisma/client";
import type { ReportModel } from "@/domain/reportModel";
import { plural } from "@/domain/reportText";
import { missingNarrative, toTemplateData } from "@/domain/templateData";
import { checkNarrative } from "@/domain/textGuards";
import { getDb } from "@/server/db";
import { revisionStatusSchema } from "@/server/dbEnums";
import { getEnv } from "@/server/env";
import { ConflictError, NotFoundError, ReportStepError } from "@/server/errors";
import { convertDocxToPdf, DOCX_MIME, PdfConversionError } from "@/server/report/gotenberg";
import { TemplateRenderError, renderDocx } from "@/server/report/renderDocx";
import { buildSnapshot, loadReportTemplate, parseSnapshot, REPORT_TEMPLATE_PATH, type ReportTemplate } from "@/server/report/snapshot";
import { loadReportModel } from "@/server/services/reportService";
import { readRevisionFile, removeRevisionFiles, saveRevisionFiles } from "@/server/storage/reports";

/** A revision still GENERATING after this long was cut off by a server restart (conversion has a 60 s limit). */
export const STALE_GENERATION_MS = 5 * 60 * 1000;

export type RevisionStatus = "GENERATING" | "READY" | "FAILED";

export type RevisionDto = {
  id: string;
  number: number;
  status: RevisionStatus;
  /** Readable failure reason; null unless FAILED. */
  error: string | null;
  snapshotHash: string;
  createdAt: string;
  /** Download names, e.g. ORTAM-DEMO-001_rev3.docx. */
  docxFileName: string;
  pdfFileName: string;
};

/**
 * current: the latest ready revision shows the current data. outdated: the data changed after it. failed: the latest
 * attempt failed after the latest ready revision. generating: an attempt is running. none: nothing was generated yet.
 */
export type ReportState = "none" | "current" | "outdated" | "generating" | "failed";

export type ReportStatusDto = {
  projectId: string;
  state: ReportState;
  /** Snapshot hash of the current data and template. */
  currentHash: string;
  latestReady: RevisionDto | null;
  /** The highest revision number, whatever its outcome. */
  lastAttempt: RevisionDto | null;
  canGenerate: boolean;
  /** Why the report cannot be generated now. Empty when canGenerate. */
  blockers: string[];
  /** Narrative texts the report would print as "Narrative not written yet.". */
  missingNarrative: string[];
  /** Guardrail warnings on the narrative that do not block generation (D-034). */
  guardWarnings: number;
  /** Every revision, newest first. */
  revisions: RevisionDto[];
};

export type GenerateResult = {
  /** false when the latest ready revision already shows the current data; nothing new was generated. */
  created: boolean;
  revision: RevisionDto;
  status: ReportStatusDto;
};

export type RevisionFile = { fileName: string; contentType: string; bytes: Uint8Array };

export type RevisionDeps = {
  db: PrismaClient;
  storageDir: string;
  templatePath: string;
  /** DOCX → PDF. Gotenberg in the app; tests pass a fake. */
  convert: (docx: Uint8Array) => Promise<Uint8Array>;
  now: () => Date;
};

const REVISION_FIELDS = {
  id: true,
  projectId: true,
  number: true,
  snapshotHash: true,
  status: true,
  error: true,
  docxPath: true,
  pdfPath: true,
  createdAt: true,
} as const satisfies Prisma.ReportRevisionSelect;

type RevisionRow = Prisma.ReportRevisionGetPayload<{ select: typeof REVISION_FIELDS }>;

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const running = () => new ConflictError("A report revision is being generated right now. Wait until it is finished.", "GENERATION_RUNNING");

/** "ORTAM-DEMO-001" → "ORTAM-DEMO-001"; anything outside letters, digits, dot, dash and underscore becomes a dash. */
export function fileStem(projectCode: string): string {
  return projectCode.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "report";
}

function toDto(row: RevisionRow, projectCode: string): RevisionDto {
  const stem = `${fileStem(projectCode)}_rev${row.number}`;
  return {
    id: row.id,
    number: row.number,
    status: revisionStatusSchema.parse(row.status),
    error: row.error,
    snapshotHash: row.snapshotHash,
    createdAt: row.createdAt.toISOString(),
    docxFileName: `${stem}.docx`,
    pdfFileName: `${stem}.pdf`,
  };
}

/** What stops generation, and the warnings that do not. */
export function generationCheck(model: ReportModel): Pick<ReportStatusDto, "canGenerate" | "blockers" | "missingNarrative" | "guardWarnings"> {
  const warnings = checkNarrative(model);
  const forbidden = warnings.filter((warning) => warning.code === "FORBIDDEN_CLAIM").length;
  const { readiness } = model.employeeReview;
  const blockers: string[] = [];
  if (!readiness.canGenerate) {
    blockers.push(`${readiness.label}. Resolve each open item or keep it flagged in Matching before the report is generated.`);
  }
  if (forbidden > 0) {
    blockers.push(
      `The narrative makes ${plural(forbidden, "claim")} the report must not make (asbestos-free, compliance, clearance or safety). Edit the text in Draft first.`,
    );
  }
  return { canGenerate: blockers.length === 0, blockers, missingNarrative: missingNarrative(model), guardWarnings: warnings.length - forbidden };
}

function reportState(rows: readonly RevisionRow[], currentHash: string): { state: ReportState; latestReady: RevisionRow | null; lastAttempt: RevisionRow | null } {
  const lastAttempt = rows[0] ?? null;
  const latestReady = rows.find((row) => row.status === "READY") ?? null;
  let state: ReportState = "none";
  if (lastAttempt?.status === "GENERATING") state = "generating";
  else if (latestReady !== null && latestReady.snapshotHash === currentHash) state = "current";
  else if (lastAttempt?.status === "FAILED" && (latestReady === null || lastAttempt.number > latestReady.number)) state = "failed";
  else if (latestReady !== null) state = "outdated";
  return { state, latestReady, lastAttempt };
}

/** Any failure of a generation step as a readable ReportStepError. */
function stepError(error: unknown): ReportStepError {
  if (error instanceof ReportStepError) return error;
  if (error instanceof PdfConversionError) return new ReportStepError(error.message, error.code);
  if (error instanceof TemplateRenderError) return new ReportStepError(error.message, error.code);
  console.error(error);
  const detail = error instanceof Error ? error.message : String(error);
  return new ReportStepError(`The report files could not be written (${detail}). Retry.`, "GENERATION_FAILED");
}

function resolveDeps(overrides: Partial<RevisionDeps>): RevisionDeps {
  return {
    db: overrides.db ?? getDb(),
    storageDir: overrides.storageDir ?? getEnv().STORAGE_DIR,
    templatePath: overrides.templatePath ?? REPORT_TEMPLATE_PATH,
    convert: overrides.convert ?? ((docx) => convertDocxToPdf(docx, { baseUrl: getEnv().GOTENBERG_URL })),
    now: overrides.now ?? (() => new Date()),
  };
}

/**
 * Report revisions: one snapshot of the report, rendered once to DOCX and once to PDF, both stored under
 * storage/reports/<projectId>/rev-<n>/. The preview and both downloads always come from the same revision.
 */
export function revisionService(overrides: Partial<RevisionDeps> = {}) {
  const deps = resolveDeps(overrides);
  const { db } = deps;

  async function expireStale(projectId: string) {
    await db.reportRevision.updateMany({
      where: { projectId, status: "GENERATING", createdAt: { lt: new Date(deps.now().getTime() - STALE_GENERATION_MS) } },
      data: { status: "FAILED", error: "Interrupted before the files were written (the server stopped during generation). Retry." },
    });
  }

  async function current(projectId: string) {
    const template = await loadReportTemplate(deps.templatePath);
    const model = await db.$transaction((tx) => loadReportModel(tx, projectId));
    return { template, model, snapshot: buildSnapshot(model, template.sha256) };
  }

  async function statusOf(projectId: string, model: ReportModel, currentHash: string): Promise<ReportStatusDto> {
    const rows = await db.reportRevision.findMany({ where: { projectId }, orderBy: { number: "desc" }, select: REVISION_FIELDS });
    const code = model.projectInformation.project.code;
    const { state, latestReady, lastAttempt } = reportState(rows, currentHash);
    return {
      projectId,
      state,
      currentHash,
      latestReady: latestReady === null ? null : toDto(latestReady, code),
      lastAttempt: lastAttempt === null ? null : toDto(lastAttempt, code),
      ...generationCheck(model),
      revisions: rows.map((row) => toDto(row, code)),
    };
  }

  /** Renders the stored snapshot to DOCX and PDF and stores both. Any failure marks the revision FAILED. */
  async function render(row: RevisionRow, snapshotJson: string, template: ReportTemplate): Promise<RevisionRow> {
    let written = false;
    try {
      const snapshot = parseSnapshot(snapshotJson);
      if (snapshot.templateSha256 !== template.sha256) throw new ReportStepError("The report template changed during generation. Retry.", "TEMPLATE_CHANGED");
      const data = toTemplateData(snapshot.model, { revisionNumber: row.number, generatedAt: row.createdAt.toISOString(), snapshotHash: row.snapshotHash });
      const docx = renderDocx(template.bytes, data);
      const pdf = await deps.convert(docx);
      const files = await saveRevisionFiles(deps.storageDir, row.projectId, row.number, { docx, pdf });
      written = true;
      // Conditional: a revision marked interrupted in the meantime stays failed.
      const updated = await db.reportRevision.updateMany({ where: { id: row.id, status: "GENERATING" }, data: { status: "READY", ...files } });
      if (updated.count === 0) throw new ReportStepError("Generation took too long and was marked as interrupted. Retry.", "INTERRUPTED");
      return await db.reportRevision.findUniqueOrThrow({ where: { id: row.id }, select: REVISION_FIELDS });
    } catch (error) {
      const failure = stepError(error);
      if (written) await removeRevisionFiles(deps.storageDir, row.projectId, row.number).catch(() => undefined);
      await db.reportRevision.update({ where: { id: row.id }, data: { status: "FAILED", error: failure.message, docxPath: null, pdfPath: null } });
      throw failure;
    }
  }

  return {
    expireStale,

    async status(projectId: string): Promise<ReportStatusDto> {
      await expireStale(projectId);
      const { model, snapshot } = await current(projectId);
      return statusOf(projectId, model, snapshot.hash);
    },

    /**
     * Generates a new revision from the current data. When the latest ready revision already has the same snapshot hash,
     * it is returned instead and nothing is generated (like a re-uploaded lab PDF).
     */
    async generate(projectId: string): Promise<GenerateResult> {
      await expireStale(projectId);
      const { template, model, snapshot } = await current(projectId);
      const check = generationCheck(model);
      if (!check.canGenerate) throw new ConflictError(check.blockers.join(" "), "REPORT_BLOCKED");

      let outcome: { row: RevisionRow; created: boolean };
      try {
        outcome = await db.$transaction(async (tx) => {
          const latestReady = await tx.reportRevision.findFirst({ where: { projectId, status: "READY" }, orderBy: { number: "desc" }, select: REVISION_FIELDS });
          if (latestReady !== null && latestReady.snapshotHash === snapshot.hash) return { row: latestReady, created: false };
          const latest = await tx.reportRevision.findFirst({ where: { projectId }, orderBy: { number: "desc" }, select: REVISION_FIELDS });
          if (latest?.status === "GENERATING") throw running();
          const row = await tx.reportRevision.create({
            data: {
              projectId,
              number: (latest?.number ?? 0) + 1,
              snapshotJson: snapshot.json,
              snapshotHash: snapshot.hash,
              status: "GENERATING",
              createdAt: deps.now(),
            },
            select: REVISION_FIELDS,
          });
          return { row, created: true };
        });
      } catch (error) {
        // Two requests at the same moment picked the same number; the unique index lets only one through.
        if (isUniqueViolation(error)) throw running();
        throw error;
      }

      const row = outcome.created ? await render(outcome.row, snapshot.json, template) : outcome.row;
      const code = model.projectInformation.project.code;
      return { created: outcome.created, revision: toDto(row, code), status: await statusOf(projectId, model, snapshot.hash) };
    },

    /** The Word or PDF file of a ready revision. Files of a failed or running revision are never served. */
    async getFile(revisionId: string, kind: "docx" | "pdf"): Promise<RevisionFile> {
      const row = await db.reportRevision.findUnique({ where: { id: revisionId }, select: { ...REVISION_FIELDS, project: { select: { code: true } } } });
      if (row === null) throw new NotFoundError("This report revision does not exist. It may have been deleted with its project.");
      const relativePath = kind === "docx" ? row.docxPath : row.pdfPath;
      if (row.status !== "READY" || relativePath === null) {
        throw new ConflictError(
          row.status === "FAILED"
            ? `Revision ${row.number} failed and has no files: ${row.error ?? "unknown error"}`
            : `Revision ${row.number} is still being generated.`,
          "REVISION_NOT_READY",
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = await readRevisionFile(deps.storageDir, relativePath);
      } catch {
        throw new NotFoundError(`The ${kind === "docx" ? "Word" : "PDF"} file of revision ${row.number} is missing from storage. Generate the report again.`);
      }
      const dto = toDto(row, row.project.code);
      return kind === "docx"
        ? { fileName: dto.docxFileName, contentType: DOCX_MIME, bytes }
        : { fileName: dto.pdfFileName, contentType: "application/pdf", bytes };
    },
  };
}

export type RevisionService = ReturnType<typeof revisionService>;
