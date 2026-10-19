"use client";

import type { MouseEvent } from "react";
import dynamic from "next/dynamic";
import { CircleCheckIcon, DownloadIcon, FileOutputIcon, LoaderCircleIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { useGenerateReport, useReportStatus } from "@/components/report/use-revisions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { revisionFileUrl } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ReportState, ReportStatusDto, RevisionDto } from "@/server/services/revisionService";

const ReportPdfViewer = dynamic(() => import("@/components/report/report-pdf-viewer"), {
  ssr: false,
  loading: () => (
    <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground" role="status">
      <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
      Loading the PDF viewer…
    </p>
  ),
});

const shortHash = (hash: string) => hash.slice(0, 12);

const STATE_BADGE: Record<ReportState, { label: string; className: string }> = {
  none: { label: "Not generated", className: "border-border bg-transparent text-muted-foreground" },
  current: { label: "Current", className: "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300" },
  outdated: { label: "Outdated", className: "bg-amber-500/20 text-amber-900 dark:text-amber-200" },
  generating: { label: "Generating", className: "bg-secondary text-secondary-foreground" },
  failed: { label: "Last attempt failed", className: "bg-destructive/10 text-destructive" },
};

/** Moves to another workspace tab the same way the tab bar does (no server round trip). */
function goToTab(event: MouseEvent<HTMLAnchorElement>, query: string) {
  event.preventDefault();
  window.history.replaceState(null, "", `?${query}`);
  window.scrollTo({ top: 0 });
}

/** A download link styled as a button, or a disabled button when the file must not be offered. */
function DownloadButton({ href, label, disabled, variant }: { href: string; label: string; disabled: boolean; variant: "default" | "outline" }) {
  if (disabled) {
    return (
      <Button variant={variant} disabled>
        <DownloadIcon aria-hidden />
        {label}
      </Button>
    );
  }
  return (
    <Button variant={variant} asChild>
      <a href={href} download>
        <DownloadIcon aria-hidden />
        {label}
      </a>
    </Button>
  );
}

export function PreviewView({ projectId, onOpenDraft }: { projectId: string; onOpenDraft: () => void }) {
  const { data: status, error, isPending, refetch } = useReportStatus(projectId);
  const generate = useGenerateReport(projectId);

  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
        Checking the report revisions…
      </p>
    );
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-destructive">Could not read the report status: {error.message}</span>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const ready = status.latestReady;
  const isCurrent = ready !== null && ready.snapshotHash === status.currentHash;
  const generating = generate.isPending || status.state === "generating";
  const failure = generate.isError ? generate.error.message : status.state === "failed" ? (status.lastAttempt?.error ?? "The last attempt failed.") : null;
  const badge = STATE_BADGE[generating ? "generating" : status.state];

  const runGenerate = () =>
    generate.mutate(undefined, {
      onSuccess: (result) =>
        toast.success(
          result.created
            ? `Revision ${result.revision.number} generated. The preview and both downloads come from it.`
            : `Revision ${result.revision.number} already shows the current data; nothing was regenerated.`,
        ),
    });

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Report revision" className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <FileOutputIcon className="size-5" aria-hidden />
              Report revision
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Generating stores a snapshot of the report and renders it once to Word (from the ORTAM master) and once to PDF. The preview
              and both downloads come from that one revision; any change afterwards marks it outdated.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
              <Badge className={badge.className}>{badge.label}</Badge>
              {ready !== null ? (
                <span>
                  Revision {ready.number} · generated {formatDateTime(ready.createdAt)} · snapshot{" "}
                  <code className="font-mono">{shortHash(ready.snapshotHash)}</code>
                </span>
              ) : (
                <span>No revision has been generated yet.</span>
              )}
            </div>
          </div>
          <GenerateButton status={status} isCurrent={isCurrent} generating={generating} onGenerate={runGenerate} />
        </div>

        {generating ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            Building the Word file from the template and converting it to PDF. This usually takes a few seconds.
          </p>
        ) : null}

        {!generating && failure !== null ? (
          <div role="alert" className="flex flex-col gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p className="flex items-start gap-2">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>The report was not generated: {failure}</span>
            </p>
            {status.canGenerate ? (
              <div>
                <Button variant="outline" size="sm" onClick={runGenerate}>
                  <RefreshCwIcon aria-hidden />
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {status.blockers.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            <p className="font-medium">The report cannot be generated yet</p>
            <ul className="list-disc pl-5">
              {status.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              <a href="?tab=review&view=matching" className="underline underline-offset-2" onClick={(event) => goToTab(event, "tab=review&view=matching")}>
                Open Matching
              </a>{" "}
              ·{" "}
              <button type="button" className="underline underline-offset-2" onClick={onOpenDraft}>
                Open Draft
              </button>
            </p>
          </div>
        ) : null}

        <DraftWarnings status={status} onOpenDraft={onOpenDraft} />

        {ready !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <DownloadButton href={revisionFileUrl(ready.id, "docx")} label={`Download Word (rev ${ready.number})`} disabled={!isCurrent} variant="default" />
            <DownloadButton href={revisionFileUrl(ready.id, "pdf")} label={`Download PDF (rev ${ready.number})`} disabled={!isCurrent} variant="outline" />
            {!isCurrent ? (
              <span className="text-xs text-muted-foreground">
                Revision {ready.number} (outdated):{" "}
                <a href={revisionFileUrl(ready.id, "docx")} download className="underline underline-offset-2">
                  Word
                </a>{" "}
                ·{" "}
                <a href={revisionFileUrl(ready.id, "pdf")} download className="underline underline-offset-2">
                  PDF
                </a>
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-label="PDF preview" className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="text-base font-semibold">Preview{ready !== null ? `: revision ${ready.number}` : ""}</h2>
        {ready === null ? (
          <p className="text-sm text-muted-foreground">No preview yet. Generate the report to see the PDF exactly as it will be downloaded.</p>
        ) : (
          <>
            {!isCurrent ? (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                Preview outdated — data changed after revision {ready.number}. Regenerate to update.
              </p>
            ) : null}
            <div className={cn("relative transition-opacity", !isCurrent && "opacity-50")}>
              {!isCurrent ? (
                <span className="absolute top-2 right-6 z-10 rounded-md bg-amber-500 px-2 py-0.5 text-xs font-medium text-amber-950">
                  Revision {ready.number} (outdated)
                </span>
              ) : null}
              <ReportPdfViewer key={ready.id} fileUrl={revisionFileUrl(ready.id, "pdf", true)} />
            </div>
          </>
        )}
      </section>

      <RevisionHistory status={status} />
    </div>
  );
}

function GenerateButton({
  status,
  isCurrent,
  generating,
  onGenerate,
}: {
  status: ReportStatusDto;
  isCurrent: boolean;
  generating: boolean;
  onGenerate: () => void;
}) {
  if (generating) {
    return (
      <Button disabled>
        <LoaderCircleIcon className="animate-spin" aria-hidden />
        Generating…
      </Button>
    );
  }
  if (isCurrent) {
    return (
      <Button variant="outline" disabled>
        <CircleCheckIcon aria-hidden />
        Up to date
      </Button>
    );
  }
  return (
    <Button onClick={onGenerate} disabled={!status.canGenerate}>
      <FileOutputIcon aria-hidden />
      {status.latestReady === null ? "Generate report" : "Regenerate"}
    </Button>
  );
}

function DraftWarnings({ status, onOpenDraft }: { status: ReportStatusDto; onOpenDraft: () => void }) {
  const missing = status.missingNarrative;
  if (missing.length === 0 && status.guardWarnings === 0) return null;
  const shown = missing.slice(0, 6);
  return (
    <div className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
      {missing.length > 0 ? (
        <p>
          {missing.length} narrative text{missing.length === 1 ? " is" : "s are"} empty and will read “Narrative not written yet.”:{" "}
          {shown.join(", ")}
          {missing.length > shown.length ? ` and ${missing.length - shown.length} more` : ""}.
        </p>
      ) : null}
      {status.guardWarnings > 0 ? (
        <p>
          {status.guardWarnings} guardrail warning{status.guardWarnings === 1 ? "" : "s"} on the narrative. They do not stop generation; check the
          texts first.
        </p>
      ) : null}
      <p className="text-xs">
        <button type="button" className="underline underline-offset-2" onClick={onOpenDraft}>
          Open Draft
        </button>
      </p>
    </div>
  );
}

const REVISION_STATUS_BADGE: Record<RevisionDto["status"], { label: string; className: string }> = {
  READY: { label: "Ready", className: "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300" },
  FAILED: { label: "Failed", className: "bg-destructive/10 text-destructive" },
  GENERATING: { label: "Generating", className: "bg-secondary text-secondary-foreground" },
};

function RevisionHistory({ status }: { status: ReportStatusDto }) {
  if (status.revisions.length === 0) return null;
  return (
    <section aria-label="Revision history" className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-base font-semibold">Revision history</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Revision</TableHead>
            <TableHead>Generated</TableHead>
            <TableHead>Snapshot</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Files</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {status.revisions.map((revision) => {
            const current = revision.status === "READY" && revision.id === status.latestReady?.id && revision.snapshotHash === status.currentHash;
            const badge = REVISION_STATUS_BADGE[revision.status];
            return (
              <TableRow key={revision.id}>
                <TableCell className="font-medium">{revision.number}</TableCell>
                <TableCell>{formatDateTime(revision.createdAt)}</TableCell>
                <TableCell>
                  <code className="font-mono text-xs">{shortHash(revision.snapshotHash)}</code>
                </TableCell>
                <TableCell className="max-w-md whitespace-normal">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={badge.className}>{badge.label}</Badge>
                    {revision.status === "READY" ? (
                      <span className="text-xs text-muted-foreground">{current ? "current" : "outdated"}</span>
                    ) : null}
                  </div>
                  {revision.status === "FAILED" && revision.error ? <p className="pt-1 text-xs text-destructive">{revision.error}</p> : null}
                </TableCell>
                <TableCell className="text-xs">
                  {revision.status === "READY" ? (
                    <span>
                      {current ? "" : `Revision ${revision.number} (outdated): `}
                      <a href={revisionFileUrl(revision.id, "docx")} download className="underline underline-offset-2">
                        Word
                      </a>{" "}
                      ·{" "}
                      <a href={revisionFileUrl(revision.id, "pdf")} download className="underline underline-offset-2">
                        PDF
                      </a>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No files</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
