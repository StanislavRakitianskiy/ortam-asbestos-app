import { z } from "zod";
import type { IssueRefs, ReviewIssue } from "./matching";

/**
 * The employee's decisions on blocking review issues and what they mean for the report. Pure: no I/O.
 *
 * - RESOLVED: the employee checked the issue and it needs no mention in the report. It changes no lab result or zone;
 *   to change what the report uses, the data is corrected and the issue then disappears on its own.
 * - FLAGGED: the issue stays in the draft; the note goes to the report's scope limitations.
 *
 * Decisions are stored by the issue's stable key, so they survive every recomputation of the match.
 */

export const ISSUE_DECISIONS = ["RESOLVED", "FLAGGED"] as const;
export type IssueDecision = (typeof ISSUE_DECISIONS)[number];

const NOTE_MAX = 500;

export const issueKeySchema = z
  .string({ error: "Choose the issue." })
  .trim()
  .min(1, { error: "Choose the issue." })
  .max(1000, { error: "must be at most 1000 characters" });

export const issueResolutionInputSchema = z.strictObject({
  issueKey: issueKeySchema,
  decision: z.enum(ISSUE_DECISIONS, { error: "Choose Resolve or Keep flagged in draft." }),
  note: z
    .string({ error: "Enter a note." })
    .trim()
    .min(1, { error: "Enter a note." })
    .max(NOTE_MAX, { error: `must be at most ${NOTE_MAX} characters` }),
});
export type IssueResolutionInput = z.input<typeof issueResolutionInputSchema>;

/** Removes a decision: the issue is open again, or an auto-cleared decision is dropped. */
export const issueReopenInputSchema = z.strictObject({ issueKey: issueKeySchema });
export type IssueReopenInput = z.input<typeof issueReopenInputSchema>;

/** A stored decision with the snapshot of the issue it was made on. */
export type StoredResolution = {
  issueKey: string;
  issueType: string;
  issueMessage: string;
  refsKey: string;
  decision: IssueDecision;
  note: string;
  /** ISO timestamp of the latest change. */
  decidedAt: string;
};

export type DecisionView = Pick<StoredResolution, "decision" | "note" | "decidedAt">;

/**
 * OPEN: blocking and undecided (or decided on evidence that has changed since). RESOLVED / FLAGGED: blocking and
 * decided. INFO: a warning; the report carries it as a limitation or it is listed for information, no decision needed.
 */
export type IssueState = "OPEN" | "RESOLVED" | "FLAGGED" | "INFO";

export type IssueView = ReviewIssue & {
  state: IssueState;
  /** The decision that applies now. */
  decision: DecisionView | null;
  /** A decision made when the issue referred to other zones, samples, lab rows or documents. It no longer applies. */
  outdatedDecision: DecisionView | null;
};

/** A decision whose issue no longer needs one: the data was corrected and the issue cleared on its own. */
export type ClearedDecision = Pick<StoredResolution, "issueKey" | "issueType" | "issueMessage" | "decision" | "note" | "decidedAt">;

/** A flagged issue as the report's scope limitations take it. */
export type FlaggedLimitation = { issueKey: string; type: ReviewIssue["type"]; message: string; note: string };

export type ReadinessStatus = "READY" | "DRAFT_WITH_FLAGS" | "BLOCKED";

export type Readiness = {
  status: ReadinessStatus;
  /** "Ready to generate", "Draft with 2 flagged items", "Blocked: 3 open items". */
  label: string;
  /** Blocking issues without a decision that applies. */
  open: number;
  /** Blocking issues the employee kept flagged in the draft. */
  flagged: number;
  /** Report generation is allowed when no blocking issue is open; flagged issues go into the report. */
  canGenerate: boolean;
};

/**
 * Canonical text of what an issue is about: its zones, samples, lab rows and documents, each sorted. A decision
 * applies only while the issue still refers to the same evidence, e.g. a new conflicting lab row reopens a resolved
 * conflict.
 */
export function refsKey(refs: IssueRefs): string {
  const part = (name: string, ids: readonly string[]) => `${name}=${[...new Set(ids)].sort().join(",")}`;
  return [
    part("zones", refs.zoneIds),
    part("samples", refs.sampleIds),
    part("rows", refs.labResultIds),
    part("documents", refs.documentIds),
  ].join(";");
}

const view = (resolution: StoredResolution): DecisionView => ({
  decision: resolution.decision,
  note: resolution.note,
  decidedAt: resolution.decidedAt,
});

/** Joins the current issues with the stored decisions. Decisions without a current blocking issue are auto-cleared. */
export function applyResolutions(
  issues: readonly ReviewIssue[],
  resolutions: readonly StoredResolution[],
): { issues: IssueView[]; autoCleared: ClearedDecision[] } {
  const byKey = new Map(resolutions.map((resolution) => [resolution.issueKey, resolution]));
  const blockingKeys = new Set(issues.filter((found) => found.severity === "blocking").map((found) => found.key));

  const views = issues.map((found): IssueView => {
    if (found.severity === "warning") return { ...found, state: "INFO", decision: null, outdatedDecision: null };
    const resolution = byKey.get(found.key);
    if (resolution === undefined) return { ...found, state: "OPEN", decision: null, outdatedDecision: null };
    if (resolution.refsKey !== refsKey(found.refs)) {
      return { ...found, state: "OPEN", decision: null, outdatedDecision: view(resolution) };
    }
    return { ...found, state: resolution.decision, decision: view(resolution), outdatedDecision: null };
  });

  const autoCleared = resolutions
    .filter((resolution) => !blockingKeys.has(resolution.issueKey))
    .map(({ issueKey, issueType, issueMessage, decision, note, decidedAt }) => ({
      issueKey,
      issueType,
      issueMessage,
      decision,
      note,
      decidedAt,
    }));

  return { issues: views, autoCleared };
}

export function flaggedLimitations(issues: readonly IssueView[]): FlaggedLimitation[] {
  return issues.flatMap((found) =>
    found.state === "FLAGGED" && found.decision !== null
      ? [{ issueKey: found.key, type: found.type, message: found.message, note: found.decision.note }]
      : [],
  );
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function readiness(issues: readonly IssueView[]): Readiness {
  const open = issues.filter((found) => found.state === "OPEN").length;
  const flagged = issues.filter((found) => found.state === "FLAGGED").length;
  if (open > 0) return { status: "BLOCKED", label: `Blocked: ${plural(open, "open item")}`, open, flagged, canGenerate: false };
  if (flagged > 0) {
    return { status: "DRAFT_WITH_FLAGS", label: `Draft with ${plural(flagged, "flagged item")}`, open, flagged, canGenerate: true };
  }
  return { status: "READY", label: "Ready to generate", open, flagged, canGenerate: true };
}
