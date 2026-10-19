"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheckIcon,
  FileTextIcon,
  InfoIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RawResponseDialog } from "@/components/lab-reports/raw-response-dialog";
import { formatResultLabel } from "@/domain/format";
import { ApiError, api, queryKeys } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AiRunSummary, FlagDto, LabDocumentDto, LabResultDto } from "@/server/services/labDocumentService";

const STATUS: Record<LabDocumentDto["status"], { label: string; className: string }> = {
  UPLOADED: { label: "Uploaded", className: "bg-muted text-muted-foreground" },
  EXTRACTING: { label: "Extracting", className: "bg-sky-500/15 text-sky-800 dark:text-sky-300" },
  NEEDS_REVIEW: { label: "Needs review", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  ACCEPTED: { label: "Accepted", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  FAILED: { label: "Failed", className: "bg-destructive/10 text-destructive" },
};

const RESULT_CLASS: Record<LabResultDto["resultLabel"], string> = {
  DETECTED: "text-red-700 dark:text-red-400",
  NOT_DETECTED: "text-foreground",
  INCONCLUSIVE: "text-amber-800 dark:text-amber-300",
};

const integer = new Intl.NumberFormat("en-CA");

export function formatRun(run: AiRunSummary): string {
  const tokens =
    run.inputTokens === null || run.outputTokens === null
      ? "tokens unknown"
      : `${integer.format(run.inputTokens)} in / ${integer.format(run.outputTokens)} out tokens`;
  return `${run.model} · ${tokens} · ${(run.durationMs / 1000).toFixed(1)} s`;
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function StatusBadge({ status }: { status: LabDocumentDto["status"] }) {
  const { label, className } = STATUS[status];
  return (
    <Badge className={className}>
      {status === "EXTRACTING" || status === "UPLOADED" ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
      {label}
    </Badge>
  );
}

export function LabDocumentCard({
  projectId,
  document,
  notice,
  onDismissNotice,
}: {
  projectId: string;
  document: LabDocumentDto;
  notice?: string;
  onDismissNotice: () => void;
}) {
  const queryClient = useQueryClient();
  const [rawRunId, setRawRunId] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState<string | null>(null);

  const extract = useMutation({
    mutationFn: (replaceReviewed: boolean) => api.extractLabDocument(projectId, document.id, replaceReviewed),
    onSuccess: () => {
      setConfirmReplace(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.labDocuments(projectId) });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "REVIEWED_RESULTS") {
        setConfirmReplace(error.message);
        return;
      }
      toast.error(`Extraction not started. ${error.message}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.labDocuments(projectId) });
    },
  });

  const busy = document.status === "UPLOADED" || document.status === "EXTRACTING";
  const run = document.extractedBy ?? document.lastRun;
  const description = [
    document.labReportId ? `Report ${document.labReportId}` : null,
    `${document.pageCount} page${document.pageCount === 1 ? "" : "s"}`,
    formatSize(document.sizeBytes),
    `uploaded ${formatDateTime(document.createdAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card aria-busy={busy}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <FileTextIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="break-all">{document.fileName}</span>
          <StatusBadge status={document.status} />
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          {document.status === "NEEDS_REVIEW" || document.status === "ACCEPTED" ? (
            <Button variant="outline" size="sm" disabled={extract.isPending} onClick={() => extract.mutate(false)}>
              <RotateCcwIcon aria-hidden />
              Extract again
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {notice ? (
          <div role="status" className="flex items-start gap-2 rounded-md bg-sky-500/10 px-3 py-2 text-sm text-sky-900 dark:text-sky-200">
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="flex-1">{notice}</span>
            <Button variant="ghost" size="icon-xs" onClick={onDismissNotice} aria-label="Dismiss">
              <XIcon aria-hidden />
            </Button>
          </div>
        ) : null}

        {busy ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            {document.status === "UPLOADED" ? "Waiting to extract…" : "Extracting results with AI… This usually takes under a minute."}
          </p>
        ) : null}

        {document.status === "FAILED" ? (
          <div role="alert" className="flex flex-col gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p className="flex items-start gap-2">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{document.error ?? "The extraction failed."} No results from this file are used.</span>
            </p>
            {document.retryable ? (
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={extract.isPending}
                onClick={() => extract.mutate(false)}
              >
                <RotateCcwIcon aria-hidden />
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}

        {document.status === "NEEDS_REVIEW" || document.status === "ACCEPTED" ? <ExtractionResults document={document} /> : null}
      </CardContent>

      {run && !busy ? (
        <CardFooter className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {document.extractedBy ? "Extracted by " : "Last attempt: "}
            {formatRun(run)}
          </span>
          {run.hasRawResponse ? (
            <Button variant="link" size="xs" className="h-auto px-0" onClick={() => setRawRunId(run.id)}>
              View raw AI response
            </Button>
          ) : null}
        </CardFooter>
      ) : null}

      <RawResponseDialog projectId={projectId} runId={rawRunId} onClose={() => setRawRunId(null)} />
      <Dialog open={confirmReplace !== null} onOpenChange={(open) => (open ? undefined : setConfirmReplace(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace reviewed results?</DialogTitle>
            <DialogDescription>
              {confirmReplace} The earlier AI values stay in the AI run history and the correction log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button variant="destructive" disabled={extract.isPending} onClick={() => extract.mutate(true)}>
              Extract again and replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FlagList({ flags, className }: { flags: FlagDto[]; className?: string }) {
  if (flags.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-1", className)}>
      {flags.map((flag, index) => (
        <li key={`${flag.code}-${index}`} className="flex items-start gap-1 text-xs text-amber-800 dark:text-amber-300">
          <TriangleAlertIcon className="mt-px size-3 shrink-0" aria-hidden />
          <span>{flag.message}</span>
        </li>
      ))}
    </ul>
  );
}

function ExtractionResults({ document }: { document: LabDocumentDto }) {
  const verified = document.results.filter((row) => row.evidenceVerified).length;
  const flagged = document.results.filter((row) => row.flags.length > 0).length;
  const header = [document.labName, document.projectRef ? `project ${document.projectRef}` : null, document.issuedDate ? `issued ${document.issuedDate}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-3">
      {header ? <p className="text-sm text-muted-foreground">{header}</p> : null}
      <p className="text-sm">
        <span className="font-medium">AI draft, not reviewed.</span>{" "}
        {document.results.length} result row{document.results.length === 1 ? "" : "s"} · {verified} with the quote found on the cited
        page · {flagged} flagged
      </p>
      <FlagList flags={document.warnings} />

      {document.results.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sample</TableHead>
              <TableHead>Layer</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Content</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead>Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {document.results.map((row) => (
              <TableRow key={row.id} className="align-top">
                <TableCell className="font-medium">{row.sampleId}</TableCell>
                <TableCell className="whitespace-normal">{row.layer}</TableCell>
                <TableCell className={cn("font-medium", RESULT_CLASS[row.resultLabel])}>{formatResultLabel(row.resultLabel)}</TableCell>
                <TableCell>{row.asbestosType ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="tabular-nums">{row.percentageRaw ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="max-w-96 whitespace-normal">
                  <div className="flex items-center gap-1 text-xs">
                    {row.evidenceVerified ? (
                      <CircleCheckIcon className="size-3 text-emerald-700 dark:text-emerald-400" aria-hidden />
                    ) : (
                      <TriangleAlertIcon className="size-3 text-amber-700 dark:text-amber-300" aria-hidden />
                    )}
                    <span>
                      Page {row.sourcePage} · {row.evidenceVerified ? "quote found" : "quote not verified"}
                    </span>
                  </div>
                  <q className="mt-1 block font-mono text-xs whitespace-pre-wrap text-muted-foreground">{row.sourceText}</q>
                  {row.labNote ? <p className="mt-1 text-xs">Lab note: {row.labNote}</p> : null}
                  <FlagList flags={row.flags} className="mt-1" />
                </TableCell>
                <TableCell className="text-xs">{row.confidence ? row.confidence.toLowerCase() : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {document.notes.length > 0 ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">Lab notes</p>
          <ul className="flex flex-col gap-1">
            {document.notes.map((note, index) => (
              <li key={index} className="flex items-start gap-2 text-muted-foreground">
                {note.verified ? (
                  <CircleCheckIcon className="mt-0.5 size-3 shrink-0 text-emerald-700 dark:text-emerald-400" aria-label="Found in the PDF" />
                ) : (
                  <TriangleAlertIcon className="mt-0.5 size-3 shrink-0 text-amber-700 dark:text-amber-300" aria-label="Not found in the PDF" />
                )}
                <span>
                  Page {note.page}
                  {note.relatedSampleIds.length > 0 ? ` (${note.relatedSampleIds.join(", ")})` : ""}: {note.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
