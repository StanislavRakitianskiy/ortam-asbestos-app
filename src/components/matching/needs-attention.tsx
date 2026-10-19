"use client";

import { useState, type FormEvent } from "react";
import { CheckIcon, FlagIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/projects/field";
import {
  ISSUE_GROUPS,
  ISSUE_GROUP_OF,
  ISSUE_STATE_BORDER,
  ISSUE_STATE_CLASS,
  ISSUE_STATE_LABELS,
  sourceLabel,
} from "@/components/matching/matching-format";
import { useDecideIssue, useReopenIssue } from "@/components/matching/use-analysis";
import type { IssueDecision, IssueView } from "@/domain/issueResolution";
import { issueResolutionInputSchema } from "@/domain/issueResolution";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ProjectAnalysisDto } from "@/server/services/analysisService";

/** Ways the Matching view sends the employee to the data behind an issue. */
export type MatchingNavigation = {
  /** Shows the lab row with its source in the Lab results view. */
  openLabRow: (documentId: string, resultId: string) => void;
  /** Opens the correction dialog of the lab row (e.g. to fix its sample ID). */
  correctLabRow: (documentId: string, resultId: string) => void;
  /** Shows the lab report in the Lab results view. */
  openDocument: (documentId: string) => void;
  /** Scrolls to the zone in the zone table. */
  showZone: (zoneId: string) => void;
};

const DECISION_TEXT: Record<IssueDecision, { title: string; description: string; action: string; done: string }> = {
  RESOLVED: {
    title: "Resolve this issue",
    description:
      "Records that you checked it and it needs no mention in the report. It changes no lab result or zone: to change what the report uses, correct or reject the lab row or edit the zone, and the issue clears on its own.",
    action: "Resolve",
    done: "Issue resolved.",
  },
  FLAGGED: {
    title: "Keep this issue flagged in the draft",
    description: "The issue stays visible and your note goes into the report's scope limitations. The report can be generated with it.",
    action: "Keep flagged in draft",
    done: "Issue kept flagged in the draft.",
  },
};

type DialogState = { issue: IssueView; decision: IssueDecision } | null;

export function NeedsAttention({ projectId, analysis, navigation }: { projectId: string; analysis: ProjectAnalysisDto; navigation: MatchingNavigation }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const reopen = useReopenIssue(projectId);
  const { issues, autoCleared } = analysis;
  const count = (state: IssueView["state"]) => issues.filter((found) => found.state === state).length;
  const groups = ISSUE_GROUPS.map((group) => ({ ...group, issues: issues.filter((found) => ISSUE_GROUP_OF[found.type] === group.id) })).filter(
    (group) => group.issues.length > 0,
  );

  const onReopen = (issueKey: string, message: string) =>
    reopen.mutate({ issueKey }, { onSuccess: () => toast.success(message), onError: (error) => toast.error(`Not saved. ${error.message}`) });

  return (
    <Card aria-labelledby="needs-attention-heading">
      <CardHeader>
        <CardTitle id="needs-attention-heading" className="flex items-center gap-2">
          Needs attention
          <Badge variant={issues.length > 0 ? "secondary" : "outline"} className="tabular-nums" aria-label={`${issues.length} items`}>
            {issues.length}
          </Badge>
        </CardTitle>
        <CardDescription className="tabular-nums">
          {count("OPEN")} open · {count("FLAGGED")} flagged in draft · {count("RESOLVED")} resolved · {count("INFO")} for information
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing needs attention: every registered sample has a result and every lab row is matched.</p>
        ) : (
          groups.map((group) => (
            <section key={group.id} aria-labelledby={`issue-group-${group.id}`} className="flex flex-col gap-2">
              <h3 id={`issue-group-${group.id}`} className="text-sm font-medium">
                {group.label} <span className="text-muted-foreground tabular-nums">· {group.issues.length}</span>
              </h3>
              <ul className="flex flex-col gap-2">
                {group.issues.map((found) => (
                  <IssueItem
                    key={found.key}
                    issue={found}
                    analysis={analysis}
                    navigation={navigation}
                    busy={reopen.isPending}
                    onDecide={(decision) => setDialog({ issue: found, decision })}
                    onReopen={() => onReopen(found.key, "Decision removed. The issue is open again.")}
                  />
                ))}
              </ul>
            </section>
          ))
        )}

        {autoCleared.length > 0 ? (
          <section aria-labelledby="auto-cleared-heading" className="flex flex-col gap-2 border-t pt-4">
            <h3 id="auto-cleared-heading" className="text-sm font-medium">
              Auto-cleared <span className="text-muted-foreground tabular-nums">· {autoCleared.length}</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              These issues are gone because the data was corrected, so your earlier decisions no longer apply.
            </p>
            <ul className="flex flex-col gap-2">
              {autoCleared.map((cleared) => (
                <li key={cleared.issueKey} className="flex flex-col gap-1 rounded-md border border-dashed p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">auto-cleared</Badge>
                    <span className="text-muted-foreground line-through decoration-muted-foreground/50">{cleared.issueMessage}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your decision: {ISSUE_STATE_LABELS[cleared.decision]} — “{cleared.note}” · {formatDateTime(cleared.decidedAt)}
                  </p>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="w-fit"
                    disabled={reopen.isPending}
                    onClick={() => onReopen(cleared.issueKey, "Cleared decision removed.")}
                  >
                    <Trash2Icon aria-hidden />
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>

      <DecisionDialog projectId={projectId} state={dialog} onClose={() => setDialog(null)} />
    </Card>
  );
}

function IssueItem({
  issue,
  analysis,
  navigation,
  busy,
  onDecide,
  onReopen,
}: {
  issue: IssueView;
  analysis: ProjectAnalysisDto;
  navigation: MatchingNavigation;
  busy: boolean;
  onDecide: (decision: IssueDecision) => void;
  onReopen: () => void;
}) {
  const zones = analysis.zones.filter((zone) => issue.refs.zoneIds.includes(zone.zone.id));
  const rows = analysis.results.filter((row) => issue.refs.labResultIds.includes(row.id));
  // Documents not reached through a lab row, e.g. a lab report still in review.
  const documents = analysis.documents.filter(
    (document) => issue.refs.documentIds.includes(document.id) && !rows.some((row) => row.documentId === document.id),
  );
  const unmatched = issue.type === "UNMATCHED_LAB_SAMPLE" ? analysis.unmatchedSamples.find((sample) => sample.issueKey === issue.key) : undefined;
  const blocking = issue.severity === "blocking";

  return (
    <li className={cn("flex flex-col gap-2 rounded-md border border-l-4 p-3", ISSUE_STATE_BORDER[issue.state])} data-issue-key={issue.key}>
      <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:gap-2">
        <Badge className={cn("shrink-0", ISSUE_STATE_CLASS[issue.state])}>{ISSUE_STATE_LABELS[issue.state]}</Badge>
        <p className="text-sm">{issue.message}</p>
      </div>

      {zones.length + rows.length + documents.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
          {zones.map((zone) => (
            <Button key={zone.zone.id} variant="link" size="xs" className="h-auto px-1" onClick={() => navigation.showZone(zone.zone.id)}>
              Zone {zone.zone.materialId}
            </Button>
          ))}
          {rows.map((row) => (
            <Button key={row.id} variant="link" size="xs" className="h-auto px-1" onClick={() => navigation.openLabRow(row.documentId, row.id)}>
              Lab row {sourceLabel(row)} · {row.sampleId} {row.layer}
            </Button>
          ))}
          {documents.map((document) => (
            <Button key={document.id} variant="link" size="xs" className="h-auto px-1" onClick={() => navigation.openDocument(document.id)}>
              {document.fileName}
            </Button>
          ))}
        </div>
      ) : null}

      {unmatched && unmatched.similar.length > 0 ? (
        <p className="text-xs">
          Similar ID in register:{" "}
          {unmatched.similar.map((similar) => `${similar.sampleId} (${similar.zones.map((zone) => zone.materialId).join(", ")})`).join(", ")}. Not
          linked: correct the sample ID on the lab row to link it.
        </p>
      ) : null}

      {issue.decision ? (
        <p className="text-xs">
          <span className="font-medium">{issue.decision.decision === "FLAGGED" ? "Note for the report:" : "Resolution note:"}</span> “
          {issue.decision.note}” <span className="text-muted-foreground">· {formatDateTime(issue.decision.decidedAt)}</span>
        </p>
      ) : null}
      {issue.outdatedDecision ? (
        <p className="text-xs text-amber-900 dark:text-amber-200">
          Your earlier decision ({ISSUE_STATE_LABELS[issue.outdatedDecision.decision]}: “{issue.outdatedDecision.note}”) no longer applies: the issue now
          refers to other evidence. Decide again.
        </p>
      ) : null}

      {blocking ? (
        <div className="flex flex-wrap gap-2">
          {unmatched && unmatched.rows[0] ? (
            <Button size="xs" variant="outline" onClick={() => navigation.correctLabRow(unmatched.rows[0].documentId, unmatched.rows[0].id)}>
              Correct sample ID
            </Button>
          ) : null}
          {issue.state !== "RESOLVED" ? (
            <Button size="xs" variant={issue.state === "OPEN" ? "default" : "outline"} onClick={() => onDecide("RESOLVED")}>
              <CheckIcon aria-hidden />
              Resolve…
            </Button>
          ) : null}
          {issue.state !== "FLAGGED" ? (
            <Button size="xs" variant="outline" onClick={() => onDecide("FLAGGED")}>
              <FlagIcon aria-hidden />
              Keep flagged in draft…
            </Button>
          ) : null}
          {issue.decision ? (
            <Button size="xs" variant="ghost" disabled={busy} onClick={onReopen}>
              <RotateCcwIcon aria-hidden />
              Reopen
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function DecisionDialog({ projectId, state, onClose }: { projectId: string; state: DialogState; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        {state ? <DecisionForm key={`${state.issue.key}-${state.decision}`} projectId={projectId} state={state} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DecisionForm({ projectId, state, onDone }: { projectId: string; state: NonNullable<DialogState>; onDone: () => void }) {
  const { issue, decision } = state;
  const text = DECISION_TEXT[decision];
  const decide = useDecideIssue(projectId);
  const [note, setNote] = useState(issue.decision?.note ?? issue.outdatedDecision?.note ?? "");
  const [error, setError] = useState<{ note?: string; form?: string }>({});

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const input = { issueKey: issue.key, decision, note };
    const parsed = issueResolutionInputSchema.safeParse(input);
    if (!parsed.success) {
      setError({ note: parsed.error.issues.find((item) => item.path[0] === "note")?.message, form: undefined });
      return;
    }
    setError({});
    decide.mutate(parsed.data, {
      onSuccess: () => {
        toast.success(text.done);
        onDone();
      },
      onError: (failure) =>
        setError(
          failure instanceof ApiError && failure.fieldErrors.note ? { note: failure.fieldErrors.note[0] } : { form: `Not saved. ${failure.message}` },
        ),
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{text.title}</DialogTitle>
        <DialogDescription>{text.description}</DialogDescription>
      </DialogHeader>
      <blockquote className="rounded-md border-l-2 border-muted-foreground/40 bg-muted/50 px-3 py-2 text-sm">{issue.message}</blockquote>
      <Field
        id="issue-note"
        label={decision === "FLAGGED" ? "Note for the report's scope limitations" : "Resolution note"}
        error={error.note}
        hint="Required. Stored with your decision."
      >
        <Textarea {...fieldAria("issue-note", error.note, true)} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} />
      </Field>
      {error.form ? (
        <p role="alert" className="text-sm text-destructive">
          {error.form}
        </p>
      ) : null}
      <DialogFooter showCloseButton>
        <Button type="submit" disabled={decide.isPending}>
          {text.action}
        </Button>
      </DialogFooter>
    </form>
  );
}
