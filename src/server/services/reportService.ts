import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { NARRATIVE_SECTIONS, NARRATIVE_SOURCES, type StoredNarrative } from "@/domain/narrative";
import { narrativeFacts, narrativeFactsJson } from "@/domain/narrativeFacts";
import { buildReportModel, type CorrectionSubject, type ReportCorrection, type ReportModel } from "@/domain/reportModel";
import { reviewChecklistInputSchema, type ReviewChecklistState } from "@/domain/reviewChecklist";
import { checkNarrative, type GuardWarning } from "@/domain/textGuards";
import { getDb } from "@/server/db";
import { parseInput } from "@/server/errors";
import { loadAnalysis } from "@/server/services/analysisService";
import { LAB_DOCUMENT_ENTITY, toRunSummary, type AiRunSummary } from "@/server/services/labDocumentDto";
import { findProjectOrThrow } from "@/server/services/projectService";

type Tx = Prisma.TransactionClient;

/** A NARRATIVE run still RUNNING after this long was cut off by a server restart (like D-019). */
export const STALE_DRAFT_MS = 10 * 60 * 1000;

export type ReportDraftDto = {
  projectId: string;
  model: ReportModel;
  /** Guardrail warnings on the current narrative, computed now (D-034). */
  warnings: GuardWarning[];
  draft: {
    /** The latest NARRATIVE AI call, whatever its outcome. */
    lastRun: AiRunSummary | null;
    /** An AI draft is being written right now. */
    running: boolean;
    /** When the latest successful AI draft was made; null if there is none. */
    draftedAt: string | null;
    /** The latest successful AI draft was made from other facts than the current ones. */
    outdated: boolean;
  };
};

const storedNarrativeSchema = z.object({
  section: z.enum(NARRATIVE_SECTIONS),
  itemKey: z.string(),
  aiText: z.string().nullable(),
  text: z.string(),
  source: z.enum(NARRATIVE_SOURCES),
});

/** Correction.oldValue / newValue are JSON text; anything unreadable is shown as stored. */
function decode(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

async function loadCorrections(tx: Tx, projectId: string): Promise<ReportCorrection[]> {
  const corrections = await tx.correction.findMany({ where: { projectId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const rowIds = corrections.filter((correction) => correction.entity === "LabResult").map((correction) => correction.entityId);
  const documentIds = corrections.filter((correction) => correction.entity === LAB_DOCUMENT_ENTITY).map((correction) => correction.entityId);
  const rows = await tx.labResult.findMany({
    where: { id: { in: rowIds } },
    include: { labDocument: { select: { fileName: true, labReportId: true } } },
  });
  const documents = await tx.labDocument.findMany({ where: { id: { in: documentIds } }, select: { id: true, fileName: true } });

  return corrections.map((correction): ReportCorrection => {
    let subject: CorrectionSubject = { kind: "UNKNOWN", entity: `${correction.entity} (no longer present)` };
    if (correction.entity === "LabResult") {
      const row = rows.find((candidate) => candidate.id === correction.entityId);
      if (row !== undefined) {
        subject = {
          kind: "LAB_ROW",
          sampleId: row.sampleId,
          layer: row.layer,
          labReportId: row.labDocument.labReportId?.trim() || row.labDocument.fileName,
          page: row.sourcePage,
        };
      }
    } else if (correction.entity === LAB_DOCUMENT_ENTITY) {
      const document = documents.find((candidate) => candidate.id === correction.entityId);
      if (document !== undefined) subject = { kind: "LAB_REPORT", fileName: document.fileName };
    }
    return {
      id: correction.id,
      subject,
      field: correction.field,
      oldValue: decode(correction.oldValue),
      newValue: decode(correction.newValue),
      reason: correction.reason,
      createdAt: correction.createdAt.toISOString(),
    };
  });
}

async function loadChecklist(tx: Tx, projectId: string): Promise<ReviewChecklistState | null> {
  const row = await tx.reviewChecklist.findUnique({ where: { projectId } });
  if (row === null) return null;
  return {
    samplesChecked: row.samplesChecked,
    layersChecked: row.layersChecked,
    quantitiesChecked: row.quantitiesChecked,
    costsChecked: row.costsChecked,
    narrativeChecked: row.narrativeChecked,
    reviewerName: row.reviewerName,
    reviewedOn: row.reviewedOn,
  };
}

/** SHA-256 of the facts the AI drafts from. A different hash than the draft's run means the draft is outdated. */
export function factsHash(model: ReportModel): string {
  return createHash("sha256").update(narrativeFactsJson(narrativeFacts(model))).digest("hex");
}

/** Builds the report model from the database in one transaction: analysis, project, sources, narrative, review. */
export async function loadReportModel(tx: Tx, projectId: string): Promise<ReportModel> {
  const analysis = await loadAnalysis(tx, projectId);
  const project = await findProjectOrThrow(tx, projectId);
  const labDocuments = await tx.labDocument.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, labReportId: true, labName: true, issuedDate: true, sha256: true, pageCount: true },
  });
  const narrative = await tx.reportNarrative.findMany({ where: { projectId }, orderBy: [{ section: "asc" }, { itemKey: "asc" }] });

  return buildReportModel({
    project: {
      code: project.code,
      client: project.client,
      building: project.building,
      address: project.address,
      inspectionDate: project.inspectionDate,
      reportDate: project.reportDate,
      preparedBy: project.preparedBy,
      reviewedBy: project.reviewedBy,
      scope: project.scope,
      plannedWork: project.plannedWork,
      limitations: project.limitations,
      jurisdictionNote: project.jurisdictionNote,
      currency: project.currency,
    },
    analysis,
    labDocuments,
    narrative: narrative.map((row): StoredNarrative => storedNarrativeSchema.parse(row)),
    corrections: await loadCorrections(tx, projectId),
    checklist: await loadChecklist(tx, projectId),
  });
}

async function loadReport(tx: Tx, projectId: string, now: Date): Promise<ReportDraftDto> {
  const model = await loadReportModel(tx, projectId);
  const lastRun = await tx.aiRun.findFirst({ where: { projectId, kind: "NARRATIVE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const lastSuccess = await tx.aiRun.findFirst({
    where: { projectId, kind: "NARRATIVE", status: "SUCCEEDED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return {
    projectId,
    model,
    warnings: checkNarrative(model),
    draft: {
      lastRun: lastRun === null ? null : toRunSummary(lastRun),
      running: lastRun?.status === "RUNNING" && now.getTime() - lastRun.createdAt.getTime() < STALE_DRAFT_MS,
      draftedAt: lastSuccess?.createdAt.toISOString() ?? null,
      outdated: lastSuccess !== null && lastSuccess.inputHash !== factsHash(model),
    },
  };
}

/** Every report change moves Project.updatedAt, so a generated revision can tell it is outdated. */
export async function touchProject(tx: Tx, projectId: string) {
  await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
}

export type ReportServiceDeps = { db: PrismaClient; now: () => Date };

/**
 * The report draft: the ReportModel built from the current data, the guardrail warnings on its narrative and the state
 * of the AI draft. Nothing derived is stored (D-027); only the narrative texts and the review checklist are.
 */
export function reportService(overrides: Partial<ReportServiceDeps> = {}) {
  const db = overrides.db ?? getDb();
  const now = overrides.now ?? (() => new Date());

  /** A draft still RUNNING after STALE_DRAFT_MS was cut off by a server restart: it failed. */
  async function expireStaleDrafts(projectId: string) {
    await db.aiRun.updateMany({
      where: { projectId, kind: "NARRATIVE", status: "RUNNING", createdAt: { lt: new Date(now().getTime() - STALE_DRAFT_MS) } },
      data: { status: "FAILED", error: "Interrupted before the call finished (the server stopped or the AI call never finished). Retry." },
    });
  }

  return {
    async get(projectId: string): Promise<ReportDraftDto> {
      await expireStaleDrafts(projectId);
      return db.$transaction((tx) => loadReport(tx, projectId, now()));
    },

    expireStaleDrafts,

    /** Saves the whole checklist with the reviewer and the review day. Answers with the updated report. */
    async saveChecklist(projectId: string, input: unknown): Promise<ReportDraftDto> {
      const values = parseInput(reviewChecklistInputSchema, input);
      return db.$transaction(async (tx) => {
        await findProjectOrThrow(tx, projectId);
        await tx.reviewChecklist.upsert({ where: { projectId }, create: { projectId, ...values }, update: values });
        await touchProject(tx, projectId);
        return loadReport(tx, projectId, now());
      });
    },
  };
}

export type ReportService = ReturnType<typeof reportService>;
