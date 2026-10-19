import type { Prisma, PrismaClient } from "@prisma/client";
import {
  draftSlots,
  isZoneSection,
  narrativeEditSchema,
  narrativeResetSchema,
  ZONE_SECTIONS,
  type NarrativeSection,
} from "@/domain/narrative";
import { draftNarrative } from "@/server/ai/draftNarrative";
import { anthropicSender, type AiCallDeps, type RunLog } from "@/server/ai/structuredCall";
import { getDb } from "@/server/db";
import { describeAnthropicKey, getEnv } from "@/server/env";
import { AiStepError, ConflictError, NotFoundError, ValidationError, parseInput } from "@/server/errors";
import { findProjectOrThrow } from "@/server/services/projectService";
import { STALE_DRAFT_MS, factsHash, loadReportModel, reportService, touchProject, type ReportDraftDto } from "@/server/services/reportService";

type Tx = Prisma.TransactionClient;

export type NarrativeDeps = {
  db: PrismaClient;
  /** Model, key status and transport for a real call. Read at call time so .env.local changes need only a restart. */
  ai: () => Omit<AiCallDeps, "runLog">;
  now: () => Date;
};

/** The result of "Draft narrative with AI": the updated report and how many edited texts were kept as they were. */
export type NarrativeDraftResult = { report: ReportDraftDto; keptEdited: number };

/** The real Anthropic call configured from .env.local. Tests replace it; the app never does. */
function realAi(): Omit<AiCallDeps, "runLog"> {
  const env = getEnv();
  return { model: env.ANTHROPIC_MODEL, keyStatus: describeAnthropicKey(env), send: anthropicSender(env.ANTHROPIC_API_KEY ?? "") };
}

function prismaRunLog(db: PrismaClient, projectId: string, inputHash: string): RunLog {
  return {
    async start(meta) {
      const run = await db.aiRun.create({
        data: { projectId, labDocumentId: null, kind: "NARRATIVE", status: "RUNNING", durationMs: 0, inputHash, ...meta },
      });
      return run.id;
    },
    async finish(runId, record) {
      await db.aiRun.update({ where: { id: runId }, data: record });
    },
  };
}

/** A zone section needs a zone of the project as itemKey; the other sections have one slot with itemKey "". */
async function checkSlot(tx: Tx, projectId: string, section: NarrativeSection, itemKey: string) {
  if (!isZoneSection(section)) {
    if (itemKey !== "") throw ValidationError.field("itemKey", "must be empty for this section");
    return;
  }
  const zone = await tx.materialZone.findFirst({ where: { id: itemKey, projectId }, select: { id: true } });
  if (zone === null) throw new NotFoundError("This material zone does not exist in the project. It may have been deleted.");
}

/**
 * The report prose: the AI draft (D-035) and the employee's edits. The AI original (aiText) and the current text are
 * kept apart; a new AI draft never overwrites a text the employee edited. Every change moves Project.updatedAt.
 */
export function narrativeService(overrides: Partial<NarrativeDeps> = {}) {
  const db = overrides.db ?? getDb();
  const ai = overrides.ai ?? realAi;
  const now = overrides.now ?? (() => new Date());
  const reports = reportService({ db, now });

  return {
    /**
     * Drafts every narrative slot with one AI call from the current facts. Runs while the request waits (D-036). On
     * failure nothing is stored and AiStepError carries the readable reason; the failed AiRun stays for the raw view.
     */
    async draft(projectId: string): Promise<NarrativeDraftResult> {
      await reports.expireStaleDrafts(projectId);
      const model = await db.$transaction((tx) => loadReportModel(tx, projectId));
      const running = await db.aiRun.findFirst({
        where: { projectId, kind: "NARRATIVE", status: "RUNNING", createdAt: { gte: new Date(now().getTime() - STALE_DRAFT_MS) } },
        select: { id: true },
      });
      if (running !== null) {
        throw new ConflictError("An AI narrative draft is already being written for this project. Wait for it to finish, then reload.", "DRAFT_RUNNING");
      }

      const outcome = await draftNarrative(model, { ...ai(), runLog: prismaRunLog(db, projectId, factsHash(model)) });
      if (!outcome.ok) throw new AiStepError(outcome.failure.message, outcome.failure.code);

      const keptEdited = await db.$transaction(async (tx) => {
        await findProjectOrThrow(tx, projectId);
        // A zone deleted while the AI was writing gets no text.
        const zoneIds = new Set((await tx.materialZone.findMany({ where: { projectId }, select: { id: true } })).map((zone) => zone.id));
        let kept = 0;
        for (const slot of draftSlots(model.findings, outcome.draft)) {
          if (isZoneSection(slot.section) && !zoneIds.has(slot.itemKey)) continue;
          const key = { projectId_section_itemKey: { projectId, section: slot.section, itemKey: slot.itemKey } };
          const existing = await tx.reportNarrative.findUnique({ where: key });
          if (existing === null) {
            await tx.reportNarrative.create({ data: { projectId, section: slot.section, itemKey: slot.itemKey, aiText: slot.text, text: slot.text, source: "AI_DRAFT" } });
          } else if (existing.source === "EDITED") {
            // The employee's text stays; "Reset to AI draft" takes the new draft.
            await tx.reportNarrative.update({ where: key, data: { aiText: slot.text } });
            kept += 1;
          } else {
            await tx.reportNarrative.update({ where: key, data: { aiText: slot.text, text: slot.text, source: "AI_DRAFT" } });
          }
        }
        await tx.reportNarrative.deleteMany({ where: { projectId, section: { in: [...ZONE_SECTIONS] }, itemKey: { notIn: [...zoneIds] } } });
        await touchProject(tx, projectId);
        return kept;
      });
      return { report: await reports.get(projectId), keptEdited };
    },

    /** Saves the employee's text of one slot. Text equal to the AI draft counts as the AI draft again. */
    async save(projectId: string, input: unknown): Promise<ReportDraftDto> {
      const { section, itemKey, text } = parseInput(narrativeEditSchema, input);
      await db.$transaction(async (tx) => {
        await findProjectOrThrow(tx, projectId);
        await checkSlot(tx, projectId, section, itemKey);
        const key = { projectId_section_itemKey: { projectId, section, itemKey } };
        const existing = await tx.reportNarrative.findUnique({ where: key });
        if (existing === null) {
          if (text === "") return;
          await tx.reportNarrative.create({ data: { projectId, section, itemKey, aiText: null, text, source: "EDITED" } });
        } else if (existing.text === text) {
          return;
        } else if (text === "" && existing.aiText === null) {
          // Nothing drafted and nothing written: the slot is empty again.
          await tx.reportNarrative.delete({ where: key });
        } else {
          const source = existing.aiText !== null && existing.aiText === text ? "AI_DRAFT" : "EDITED";
          await tx.reportNarrative.update({ where: key, data: { text, source } });
        }
        await touchProject(tx, projectId);
      });
      return reports.get(projectId);
    },

    /** Puts the AI draft back in place of the employee's text. */
    async reset(projectId: string, input: unknown): Promise<ReportDraftDto> {
      const { section, itemKey } = parseInput(narrativeResetSchema, input);
      await db.$transaction(async (tx) => {
        await findProjectOrThrow(tx, projectId);
        await checkSlot(tx, projectId, section, itemKey);
        const key = { projectId_section_itemKey: { projectId, section, itemKey } };
        const existing = await tx.reportNarrative.findUnique({ where: key });
        if (existing === null || existing.aiText === null) throw new ConflictError("This text has no AI draft to go back to.");
        if (existing.text === existing.aiText && existing.source === "AI_DRAFT") return;
        await tx.reportNarrative.update({ where: key, data: { text: existing.aiText, source: "AI_DRAFT" } });
        await touchProject(tx, projectId);
      });
      return reports.get(projectId);
    },
  };
}

export type NarrativeService = ReturnType<typeof narrativeService>;
