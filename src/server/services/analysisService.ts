import type { Prisma, PrismaClient } from "@prisma/client";
import { analyzeProject, type ProjectAnalysis } from "@/domain/analysis";
import {
  issueReopenInputSchema,
  issueResolutionInputSchema,
  refsKey,
  type StoredResolution,
} from "@/domain/issueResolution";
import type { LabDocumentState, RowEvidence } from "@/domain/labRowIssues";
import { getDb } from "@/server/db";
import { confidenceSchema, issueDecisionSchema, labDocumentStatusSchema } from "@/server/dbEnums";
import { ConflictError, NotFoundError, parseInput } from "@/server/errors";
import { flagsSchema } from "@/server/services/labDocumentDto";
import { findAcceptedRows, toAcceptedLabResult } from "@/server/services/labReviewService";
import { findProjectOrThrow, findZones } from "@/server/services/projectService";

type Tx = Prisma.TransactionClient;

export type ProjectAnalysisDto = ProjectAnalysis & { projectId: string };

/** Reads zones, accepted lab rows, lab report states and decisions in one transaction and analyzes them. */
async function loadAnalysis(tx: Tx, projectId: string): Promise<ProjectAnalysisDto> {
  await findProjectOrThrow(tx, projectId);
  const zones = await findZones(tx, projectId);
  const rows = await findAcceptedRows(tx, projectId);
  const documents = await tx.labDocument.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fileName: true,
      labReportId: true,
      status: true,
      _count: { select: { results: { where: { reviewStatus: "PENDING" } } } },
    },
  });
  const resolutions = await tx.reviewIssueResolution.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });

  const evidence = rows.map(
    (row): RowEvidence => ({
      labResultId: row.id,
      evidenceVerified: row.evidenceVerified,
      confidence: row.confidence === null ? null : confidenceSchema.parse(row.confidence),
      flags: flagsSchema.parse(JSON.parse(row.verificationJson)),
    }),
  );
  const documentStates = documents.map(
    (document): LabDocumentState => ({
      id: document.id,
      fileName: document.fileName,
      labReportId: document.labReportId,
      status: labDocumentStatusSchema.parse(document.status),
      pendingRows: document._count.results,
    }),
  );
  const stored = resolutions.map(
    (resolution): StoredResolution => ({
      issueKey: resolution.issueKey,
      issueType: resolution.issueType,
      issueMessage: resolution.issueMessage,
      refsKey: resolution.refsKey,
      decision: issueDecisionSchema.parse(resolution.decision),
      note: resolution.note,
      decidedAt: resolution.updatedAt.toISOString(),
    }),
  );

  return {
    projectId,
    ...analyzeProject({
      zones,
      results: rows.map(toAcceptedLabResult),
      evidence,
      documents: documentStates,
      resolutions: stored,
    }),
  };
}

/** A decision changes what the report says, so it moves Project.updatedAt like every other edit. */
async function touchProject(tx: Tx, projectId: string) {
  await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
}

/**
 * The project's matching, categories, cost scenario and review issues, computed from the database on every read
 * (src/domain/analysis.ts). The one source for the Matching view, the report and the plans. Also stores the
 * employee's decisions on blocking issues.
 */
export function analysisService(db: PrismaClient = getDb()) {
  return {
    get(projectId: string): Promise<ProjectAnalysisDto> {
      return db.$transaction((tx) => loadAnalysis(tx, projectId));
    },

    /**
     * Resolves a blocking issue or keeps it flagged in the draft, with a note. The decision is stored by the issue's
     * stable key with a snapshot of the issue and of the evidence it refers to. Warnings need no decision.
     */
    async decide(projectId: string, input: unknown): Promise<ProjectAnalysisDto> {
      const { issueKey, decision, note } = parseInput(issueResolutionInputSchema, input);
      return db.$transaction(async (tx) => {
        const current = await loadAnalysis(tx, projectId);
        const found = current.issues.find((item) => item.key === issueKey);
        if (found === undefined) {
          throw new ConflictError(
            "This issue no longer exists: the data changed after the page was loaded. Check the updated list.",
            "ISSUE_GONE",
          );
        }
        if (found.severity !== "blocking") {
          throw new ConflictError("This item is a limitation the report already carries. It needs no decision.");
        }
        const snapshot = { issueType: found.type, issueMessage: found.message, refsKey: refsKey(found.refs), decision, note };
        await tx.reviewIssueResolution.upsert({
          where: { projectId_issueKey: { projectId, issueKey } },
          create: { projectId, issueKey, ...snapshot },
          update: snapshot,
        });
        await touchProject(tx, projectId);
        return loadAnalysis(tx, projectId);
      });
    },

    /** Removes a decision. A current issue is open again; an auto-cleared decision is simply dropped. */
    async reopen(projectId: string, input: unknown): Promise<ProjectAnalysisDto> {
      const { issueKey } = parseInput(issueReopenInputSchema, input);
      return db.$transaction(async (tx) => {
        await findProjectOrThrow(tx, projectId);
        const { count } = await tx.reviewIssueResolution.deleteMany({ where: { projectId, issueKey } });
        if (count === 0) throw new NotFoundError("There is no decision on this issue. It may already have been reopened.");
        await touchProject(tx, projectId);
        return loadAnalysis(tx, projectId);
      });
    },
  };
}

export type AnalysisService = ReturnType<typeof analysisService>;
