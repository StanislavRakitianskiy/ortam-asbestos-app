"use client";

import { Fragment, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCheckIcon, CircleCheckIcon, CircleXIcon, FileTextIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FlagList, RESULT_CLASS, StatusBadge } from "@/components/lab-reports/lab-document-card";
import { REVIEW_STATUS_CLASS, REVIEW_STATUS_LABELS, correctedFields } from "@/components/review/review-format";
import { useApplyDocument } from "@/components/review/use-review";
import { formatResultLabel } from "@/domain/format";
import { isBulkAcceptable, reviewProgress } from "@/domain/labReview";
import { normalizeSampleId } from "@/domain/sampleId";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LabDocumentDto, LabResultDto } from "@/server/services/labDocumentDto";

const COLUMNS = 9;

/** Rows grouped by normalized sample ID, groups in the order the lab printed them. */
function groupBySample(rows: readonly LabResultDto[]): { sampleId: string; rows: LabResultDto[] }[] {
  const groups = new Map<string, LabResultDto[]>();
  for (const row of rows) {
    const key = normalizeSampleId(row.sampleId) || "(no sample ID)";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([sampleId, grouped]) => ({ sampleId, rows: grouped }));
}

export function DocumentReview({
  projectId,
  document,
  selectedId,
  onSelect,
  onAdd,
  onEditReportId,
}: {
  projectId: string;
  document: LabDocumentDto;
  selectedId: string | null;
  onSelect: (resultId: string) => void;
  onAdd: () => void;
  onEditReportId: () => void;
}) {
  const apply = useApplyDocument(projectId);
  const progress = reviewProgress(document.results);
  const verifiedCount = document.results.filter(isBulkAcceptable).length;

  const acceptVerified = useMutation({
    mutationFn: () => api.acceptVerifiedLabResults(projectId, document.id),
    onSuccess: ({ accepted, document: updated }) => {
      apply(updated);
      toast.success(`${accepted} verified row${accepted === 1 ? "" : "s"} accepted.`);
    },
    onError: (error) => toast.error(`Not saved. ${error.message}`),
  });

  const details = [document.labName, `${document.pageCount} page${document.pageCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <FileTextIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="break-all">{document.fileName}</span>
          <StatusBadge status={document.status} />
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-1">
          {document.labReportId ? (
            <span>
              Report {document.labReportId}
              {document.labReportIdEntered ? " (entered by the employee)" : ""}
            </span>
          ) : (
            <span className="text-amber-800 dark:text-amber-300">No lab report ID</span>
          )}
          <Button variant="link" size="xs" className="h-auto px-1" onClick={onEditReportId}>
            {document.labReportId ? "Edit" : "Enter ID"}
          </Button>
          <span>· {details}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <p className="text-sm">
              <span className="font-medium tabular-nums">
                {progress.reviewed} of {progress.total} reviewed
              </span>
              <span className="text-muted-foreground">
                {" "}
                · {progress.accepted} accepted · {progress.rejected} rejected
              </span>
            </p>
            <div
              className="h-1.5 w-full max-w-64 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Rows reviewed"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.reviewed}
            >
              <div
                className="h-full bg-emerald-600 transition-[width]"
                style={{ width: `${progress.total === 0 ? 0 : (progress.reviewed / progress.total) * 100}%` }}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A span keeps the tooltip working while the button is disabled. */}
                <span tabIndex={verifiedCount === 0 ? 0 : undefined}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={verifiedCount === 0 || acceptVerified.isPending}
                    onClick={() => acceptVerified.mutate()}
                  >
                    <CheckCheckIcon aria-hidden />
                    Accept all verified ({verifiedCount})
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                Accepts pending rows whose quote was found on the cited page, whose AI confidence is not low and that have no open
                check. Every other row needs your own look.
              </TooltipContent>
            </Tooltip>
            <Button size="sm" variant="outline" onClick={onAdd}>
              <PlusIcon aria-hidden />
              Add missing row
            </Button>
          </div>
        </div>

        {document.status === "ACCEPTED" ? (
          <p className="text-sm text-emerald-800 dark:text-emerald-300">
            Every row is reviewed. The accepted rows of this lab report are used for matching and the report.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a row to check its source, then accept, reject or correct it. Nothing from this lab report is used until every
            row is accepted or rejected.
          </p>
        )}
        <FlagList flags={document.warnings} />

        {document.results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rows were extracted. Add the rows from the PDF by hand.</p>
        ) : (
          <Table className="text-xs [&_td]:px-1.5 [&_th]:px-1.5">
            <TableHeader>
              <TableRow>
                <TableHead>Sample ID</TableHead>
                <TableHead>Layer</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">Page</TableHead>
                <TableHead>
                  <abbr title="AI confidence" className="no-underline">
                    Conf.
                  </abbr>
                </TableHead>
                <TableHead className="text-center">Evidence</TableHead>
                <TableHead>Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupBySample(document.results).map((group) => (
                <Fragment key={group.sampleId}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={COLUMNS} className="py-1 font-medium">
                      Sample {group.sampleId}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {group.rows.length} layer{group.rows.length === 1 ? "" : "s"}
                      </span>
                    </TableCell>
                  </TableRow>
                  {group.rows.map((row) => (
                    <ResultRow key={row.id} row={row} selected={row.id === selectedId} onSelect={() => onSelect(row.id)} />
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** One row; selecting it opens its source and the accept, reject and correct actions in the Source panel. */
function ResultRow({ row, selected, onSelect }: { row: LabResultDto; selected: boolean; onSelect: () => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };
  const dash = <span className="text-muted-foreground">—</span>;

  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn("cursor-pointer align-top focus-visible:outline-2 focus-visible:outline-ring", row.reviewStatus === "REJECTED" && "text-muted-foreground")}
    >
      <TableCell className="font-medium">{row.sampleId || dash}</TableCell>
      <TableCell className="min-w-24 whitespace-normal">{row.layer || dash}</TableCell>
      <TableCell className={cn("font-medium", row.reviewStatus !== "REJECTED" && RESULT_CLASS[row.resultLabel])}>
        {formatResultLabel(row.resultLabel)}
      </TableCell>
      <TableCell>{row.asbestosType ?? dash}</TableCell>
      <TableCell className="text-right tabular-nums" title={row.percentageRaw ?? undefined}>
        {row.percentage === null ? dash : `${row.percentage}%`}
      </TableCell>
      <TableCell className="text-right tabular-nums">{row.sourcePage}</TableCell>
      <TableCell>{row.confidence ? row.confidence.toLowerCase() : <span className="text-muted-foreground">manual</span>}</TableCell>
      <TableCell className="text-center">
        <EvidenceIcon row={row} />
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Badge className={REVIEW_STATUS_CLASS[row.reviewStatus]}>{REVIEW_STATUS_LABELS[row.reviewStatus]}</Badge>
          {row.corrections.length > 0 ? <CorrectedBadge row={row} /> : null}
          {row.origin === "MANUAL" ? <Badge variant="outline">Manual</Badge> : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function EvidenceIcon({ row }: { row: LabResultDto }) {
  const icon = row.evidenceVerified ? (
    <CircleCheckIcon className="size-4 text-emerald-700 dark:text-emerald-400" aria-label="Quote found on the cited page" />
  ) : (
    <CircleXIcon className="size-4 text-destructive" aria-label="Quote not found on the cited page" />
  );
  if (row.flags.length === 0) return <span className="inline-flex">{icon}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-0.5" tabIndex={0}>
          {icon}
          <TriangleAlertIcon className="size-3 text-amber-700 dark:text-amber-300" aria-hidden />
          <span className="sr-only">{row.flags.length} open check(s)</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        <ul className="flex list-disc flex-col gap-1 pl-3">
          {row.flags.map((flag, index) => (
            <li key={`${flag.code}-${index}`}>{flag.message}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/** "Corrected" with every changed field, e.g. "Sample ID — AI: S7 → Employee: S07", and the reasons. */
function CorrectedBadge({ row }: { row: LabResultDto }) {
  const before = row.origin === "AI" ? "AI" : "Before";
  const reasons = [...new Set(row.corrections.map((correction) => correction.reason))];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" tabIndex={0} className="cursor-help border-sky-600/40 text-sky-800 dark:text-sky-300">
          Corrected
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        <div className="flex flex-col gap-1">
          {correctedFields(row).map((change) => (
            <span key={change.field}>
              {change.label} — {before}: {change.from} → Employee: {change.to}
            </span>
          ))}
          <span className="opacity-80">Reason: {reasons.join("; ")}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
