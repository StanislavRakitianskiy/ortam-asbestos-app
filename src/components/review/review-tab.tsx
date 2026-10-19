"use client";

import { useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/lab-reports/lab-document-card";
import { useLabDocuments } from "@/components/lab-reports/lab-reports-tab";
import { DocumentReview } from "@/components/review/document-review";
import { AddResultDialog, EditResultDialog, LabReportIdDialog, RejectResultDialog } from "@/components/review/result-dialogs";
import { SourcePanel, type RowAction } from "@/components/review/source-panel";
import { useDecision } from "@/components/review/use-review";
import { reviewProgress } from "@/domain/labReview";
import type { LabDocumentDto, LabResultDto } from "@/server/services/labDocumentDto";

type Selection = { documentId: string; resultId: string };
type DialogState =
  | { kind: "edit" | "reject"; documentId: string; resultId: string }
  | { kind: "add" | "reportId"; documentId: string };

const isReviewable = (document: LabDocumentDto) => document.status === "NEEDS_REVIEW" || document.status === "ACCEPTED";

/** Pending rows across the project's lab reports, for the tab badge. */
export function pendingRowCount(documents: readonly LabDocumentDto[] | undefined): number {
  return (documents ?? []).filter(isReviewable).reduce((sum, document) => sum + reviewProgress(document.results).pending, 0);
}

export function ReviewTab({ projectId }: { projectId: string }) {
  const { data: documents, error, isPending, refetch } = useLabDocuments(projectId);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const decide = useDecision(projectId);

  const find = (documentId: string | undefined, resultId?: string) => {
    const document = documents?.find((item) => item.id === documentId && isReviewable(item));
    const row = resultId === undefined ? undefined : document?.results.find((item) => item.id === resultId);
    return { document, row };
  };
  const selected = find(selection?.documentId, selection?.resultId);
  const dialogTarget = find(dialog?.documentId, dialog && "resultId" in dialog ? dialog.resultId : undefined);

  function act(document: LabDocumentDto, row: LabResultDto, action: RowAction) {
    if (action === "accept" || action === "reopen") {
      decide.mutate({ documentId: document.id, resultId: row.id, input: { decision: action === "accept" ? "ACCEPT" : "REOPEN" } });
      return;
    }
    setDialog({ kind: action === "edit" ? "edit" : "reject", documentId: document.id, resultId: row.id });
  }

  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
        Loading lab results…
      </p>
    );
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-destructive">Could not load the lab results: {error.message}</span>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const reviewable = documents.filter(isReviewable);
  const waiting = documents.filter((document) => !isReviewable(document));
  const totals = reviewProgress(reviewable.flatMap((document) => document.results));
  const accepted = reviewable.filter((document) => document.status === "ACCEPTED").length;
  const busyId = decide.isPending ? (decide.variables?.resultId ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="extracted-results-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="extracted-results-heading" className="text-lg font-semibold">
            Extracted lab results
          </h2>
          <p className="text-sm text-muted-foreground">
            Check every AI row against its source, correct what is wrong (with a reason) and accept or reject it. Only accepted rows
            of fully reviewed lab reports are used for matching and the report.
          </p>
          {reviewable.length > 0 ? (
            <p className="text-sm tabular-nums">
              {totals.reviewed} of {totals.total} rows reviewed · {accepted} of {reviewable.length} lab report
              {reviewable.length === 1 ? "" : "s"} accepted
            </p>
          ) : null}
        </div>

        {documents.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No lab reports yet</CardTitle>
              <CardDescription>Upload the laboratory PDFs on the Lab reports tab; their extracted rows appear here for review.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="flex min-w-0 flex-col gap-4">
              {reviewable.map((document) => (
                <DocumentReview
                  key={document.id}
                  projectId={projectId}
                  document={document}
                  selectedId={selection?.documentId === document.id ? selection.resultId : null}
                  onSelect={(resultId) => setSelection({ documentId: document.id, resultId })}
                  onAdd={() => setDialog({ kind: "add", documentId: document.id })}
                  onEditReportId={() => setDialog({ kind: "reportId", documentId: document.id })}
                />
              ))}
              {waiting.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Not ready for review</CardTitle>
                    <CardDescription>These files have no results to review yet. Follow them on the Lab reports tab.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex flex-col gap-2 text-sm">
                      {waiting.map((document) => (
                        <li key={document.id} className="flex flex-wrap items-center gap-2">
                          <span className="break-all">{document.fileName}</span>
                          <StatusBadge status={document.status} />
                          {document.status === "FAILED" ? (
                            <span className="text-destructive">{document.error ?? "The extraction failed."}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}
            </div>
            <SourcePanel
              projectId={projectId}
              document={selected.document}
              row={selected.row}
              busy={selected.row !== undefined && busyId === selected.row.id}
              onAction={(action) => (selected.document && selected.row ? act(selected.document, selected.row, action) : undefined)}
              onClose={() => setSelection(null)}
              className="lg:sticky lg:top-4"
            />
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Matching: not built yet</CardTitle>
          <CardDescription>
            Coming in the next phase: accepted rows are matched to material zones by exact sample ID, and every open issue is resolved or
            flagged.
          </CardDescription>
        </CardHeader>
      </Card>

      <EditResultDialog
        projectId={projectId}
        document={dialog?.kind === "edit" ? dialogTarget.document : undefined}
        row={dialog?.kind === "edit" ? dialogTarget.row : undefined}
        onClose={() => setDialog(null)}
      />
      <RejectResultDialog
        projectId={projectId}
        document={dialog?.kind === "reject" ? dialogTarget.document : undefined}
        row={dialog?.kind === "reject" ? dialogTarget.row : undefined}
        onClose={() => setDialog(null)}
      />
      <AddResultDialog
        projectId={projectId}
        document={dialog?.kind === "add" ? dialogTarget.document : undefined}
        onClose={() => setDialog(null)}
      />
      <LabReportIdDialog
        projectId={projectId}
        document={dialog?.kind === "reportId" ? dialogTarget.document : undefined}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
