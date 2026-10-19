"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  CheckIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PencilIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FlagList, RESULT_CLASS } from "@/components/lab-reports/lab-document-card";
import { REVIEW_STATUS_CLASS, REVIEW_STATUS_LABELS, formatContent, formatFieldValue } from "@/components/review/review-format";
import { formatResultLabel } from "@/domain/format";
import { RESULT_FIELD_LABELS } from "@/domain/labReviewInput";
import { labDocumentFileUrl } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import type { LabDocumentDto, LabResultDto } from "@/server/services/labDocumentDto";

const PdfPageView = dynamic(() => import("@/components/review/pdf-page-view"), {
  ssr: false,
  loading: () => (
    <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground" role="status">
      <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
      Loading the PDF viewer…
    </p>
  ),
});

export type RowAction = "accept" | "reject" | "reopen" | "edit";

const ZOOMS = [1, 1.5, 2, 3] as const;

export function SourcePanel({
  projectId,
  document,
  row,
  busy,
  onAction,
  onClose,
  className,
}: {
  projectId: string;
  document: LabDocumentDto | undefined;
  row: LabResultDto | undefined;
  busy: boolean;
  onAction: (action: RowAction) => void;
  onClose: () => void;
  className?: string;
}) {
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);

  if (!document || !row) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Source</CardTitle>
          <CardDescription>Select a result row to see its file, page and quoted line, highlighted in the PDF.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className} aria-label="Source of the selected row">
      <CardHeader>
        <CardTitle>Source</CardTitle>
        <CardDescription className="break-all">
          {document.fileName} · page {row.sourcePage} of {document.pageCount}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close the source panel">
            <XIcon aria-hidden />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SourceDetails
          key={row.id}
          projectId={projectId}
          document={document}
          row={row}
          busy={busy}
          zoom={zoom}
          onZoom={setZoom}
          onAction={onAction}
        />
      </CardContent>
    </Card>
  );
}

function SourceDetails({
  projectId,
  document,
  row,
  busy,
  zoom,
  onZoom,
  onAction,
}: {
  projectId: string;
  document: LabDocumentDto;
  row: LabResultDto;
  busy: boolean;
  zoom: (typeof ZOOMS)[number];
  onZoom: (zoom: (typeof ZOOMS)[number]) => void;
  onAction: (action: RowAction) => void;
}) {
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const pageExists = row.sourcePage >= 1 && row.sourcePage <= document.pageCount;
  const fileUrl = labDocumentFileUrl(projectId, document.id);
  const zoomIndex = ZOOMS.indexOf(zoom);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1">
        <p className="font-medium">
          {row.sampleId || "(no sample ID)"} · {row.layer || "(no layer)"} ·{" "}
          <span className={RESULT_CLASS[row.resultLabel]}>{formatResultLabel(row.resultLabel)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {row.asbestosType ?? "Type not reported"} · content {formatContent(row)}
          {row.origin === "MANUAL" ? " · added by the employee" : row.confidence ? ` · AI confidence ${row.confidence.toLowerCase()}` : ""}
        </p>
      </div>

      <figure className="flex flex-col gap-1">
        <figcaption className="text-xs font-medium text-muted-foreground">Quoted line</figcaption>
        <blockquote className="rounded-md border-l-2 border-amber-500 bg-muted/50 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap">
          {row.sourceText === "" ? <span className="text-muted-foreground">(empty)</span> : row.sourceText}
        </blockquote>
      </figure>

      <EvidenceStatus row={row} pageExists={pageExists} pageCount={document.pageCount} matchCount={matchCount} />
      <FlagList flags={row.flags} />
      {row.labNote ? (
        <p className="text-xs">
          <span className="font-medium">Lab note:</span> {row.labNote}
        </p>
      ) : null}

      <ReviewState row={row} />

      <div className="flex flex-wrap gap-2">
        {row.reviewStatus !== "ACCEPTED" ? (
          <Button size="sm" disabled={busy} onClick={() => onAction("accept")}>
            <CheckIcon aria-hidden />
            Accept
          </Button>
        ) : null}
        {row.reviewStatus !== "REJECTED" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("reject")}>
            <XIcon aria-hidden />
            Reject
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("edit")}>
          <PencilIcon aria-hidden />
          Correct
        </Button>
        {row.reviewStatus !== "PENDING" ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction("reopen")}>
            <RotateCcwIcon aria-hidden />
            Back to pending
          </Button>
        ) : null}
      </div>

      {pageExists ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Page {row.sourcePage}, as stored</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={zoomIndex === 0}
                onClick={() => onZoom(ZOOMS[zoomIndex - 1])}
                aria-label="Zoom out"
              >
                <ZoomOutIcon aria-hidden />
              </Button>
              <span className="w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={zoomIndex === ZOOMS.length - 1}
                onClick={() => onZoom(ZOOMS[zoomIndex + 1])}
                aria-label="Zoom in"
              >
                <ZoomInIcon aria-hidden />
              </Button>
              <Button variant="link" size="xs" asChild>
                <a href={`${fileUrl}#page=${row.sourcePage}`} target="_blank" rel="noreferrer">
                  Open PDF
                  <ExternalLinkIcon aria-hidden />
                </a>
              </Button>
            </div>
          </div>
          <PdfViewport fileUrl={fileUrl} pageNumber={row.sourcePage} quote={row.sourceText} zoom={zoom} onQuoteMatch={setMatchCount} />
        </div>
      ) : null}
    </div>
  );
}

function EvidenceStatus({
  row,
  pageExists,
  pageCount,
  matchCount,
}: {
  row: LabResultDto;
  pageExists: boolean;
  pageCount: number;
  matchCount: number | null;
}) {
  const notFound = (detail?: string) => (
    <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 font-medium text-destructive">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Evidence not found on this page — verify manually.
        {detail ? <span className="block text-xs font-normal">{detail}</span> : null}
      </span>
    </p>
  );
  if (!pageExists) return notFound(`Page ${row.sourcePage} does not exist; the PDF has ${pageCount} page${pageCount === 1 ? "" : "s"}.`);
  if (matchCount === 0 || (matchCount === null && !row.evidenceVerified)) return notFound();
  if (matchCount === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <LoaderCircleIcon className="size-3 animate-spin" aria-hidden />
        Checking the quote against the page text…
      </p>
    );
  }
  if (matchCount > 1) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-200">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        The quote matches {matchCount} lines on this page, so it does not identify one row — verify manually.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
      <CircleCheckIcon className="size-4 shrink-0" aria-hidden />
      Quote found on page {row.sourcePage}; it is highlighted below.
    </p>
  );
}

function ReviewState({ row }: { row: LabResultDto }) {
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Review</span>
        <Badge className={REVIEW_STATUS_CLASS[row.reviewStatus]}>{REVIEW_STATUS_LABELS[row.reviewStatus]}</Badge>
        {row.origin === "MANUAL" ? <Badge variant="outline">Added by hand</Badge> : null}
      </div>
      {row.reviewStatus === "REJECTED" && row.rejectReason ? <p className="text-xs">Rejected: {row.rejectReason}</p> : null}
      {row.addedReason ? <p className="text-xs">Added because: {row.addedReason}</p> : null}
      {row.corrections.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">Correction log</p>
          <ol className="flex flex-col gap-1 text-xs">
            {row.corrections.map((correction) => (
              <li key={correction.id}>
                <span className="font-medium">{RESULT_FIELD_LABELS[correction.field]}:</span>{" "}
                {formatFieldValue(correction.field, correction.oldValue)} → {formatFieldValue(correction.field, correction.newValue)}{" "}
                <span className="text-muted-foreground">
                  · “{correction.reason}” · {formatDateTime(correction.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** The scrollable page view. Its width follows the panel; zoom enlarges the page inside the scroll area. */
function PdfViewport({
  fileUrl,
  pageNumber,
  quote,
  zoom,
  onQuoteMatch,
}: {
  fileUrl: string;
  pageNumber: number;
  quote: string;
  zoom: number;
  onQuoteMatch: (count: number | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Scrolls only this box (not the page) so the first mark is in view. */
  const showMark = useCallback(() => {
    const container = scrollRef.current;
    const target = container?.querySelector("mark.evidence-mark");
    if (!container || !target) return;
    const box = container.getBoundingClientRect();
    const markBox = target.getBoundingClientRect();
    container.scrollTop += markBox.top - box.top - box.height / 3;
    container.scrollLeft += markBox.left - box.left - 16;
  }, []);

  return (
    <div ref={scrollRef} className="max-h-[60vh] overflow-auto rounded-md border bg-white [scrollbar-gutter:stable]">
      {width > 0 ? (
        <PdfPageView
          fileUrl={fileUrl}
          pageNumber={pageNumber}
          quote={quote}
          width={Math.round(width * zoom)}
          onQuoteMatch={onQuoteMatch}
          onRendered={showMark}
        />
      ) : null}
    </div>
  );
}
