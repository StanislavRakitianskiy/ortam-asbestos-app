"use client";

import { useState, type MouseEvent } from "react";
import { FileTextIcon, LoaderCircleIcon, PencilLineIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { RawResponseDialog } from "@/components/lab-reports/raw-response-dialog";
import { READINESS_CLASS } from "@/components/matching/matching-format";
import { GuardWarnings, NarrativeField, narrativeFieldId } from "@/components/report/narrative-field";
import {
  Appendices,
  AssumptionsAndExclusions,
  CategoryBadge,
  CostScenario,
  FindingFacts,
  ProjectInformation,
  ReportSection,
} from "@/components/report/report-sections";
import { ReviewChecklistForm } from "@/components/report/review-checklist-form";
import { useDraftNarrative, useReport } from "@/components/report/use-report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NARRATIVE_LABELS, type NarrativeSection } from "@/domain/narrative";
import { GUARD_TITLES, type GuardWarning } from "@/domain/textGuards";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ReportDraftDto } from "@/server/services/reportService";

const SECTIONS = [
  { id: "report-project", title: "Project information" },
  { id: "report-summary", title: "Executive summary" },
  { id: "report-findings", title: "Findings and traceability" },
  { id: "report-recommendations", title: "Recommendations" },
  { id: "report-limitations", title: "Scope limitations" },
  { id: "report-costs", title: "Cost scenario" },
  { id: "report-exclusions", title: "Assumptions and exclusions" },
  { id: "report-review", title: "Employee review" },
] as const;

const findingId = (zoneId: string) => `report-finding-${zoneId}`;

/** Moves to another workspace tab the same way the tab bar does (no server round trip). */
function goToTab(event: MouseEvent<HTMLAnchorElement>, query: string) {
  event.preventDefault();
  window.history.replaceState(null, "", `?${query}`);
  window.scrollTo({ top: 0 });
}

function scrollToId(event: MouseEvent<HTMLAnchorElement>, id: string) {
  event.preventDefault();
  window.document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Where a warning is, for the summary list: the block's anchor and a readable label. */
function warningTarget(report: ReportDraftDto, warning: GuardWarning): { id: string; label: string } {
  const zone = report.model.findings.find((finding) => finding.zoneId === warning.itemKey);
  if (warning.section === null) return { id: findingId(warning.itemKey), label: `${zone?.materialId ?? "Zone"} findings` };
  const section: NarrativeSection = warning.section;
  return {
    id: narrativeFieldId(section, warning.itemKey),
    label: zone === undefined ? NARRATIVE_LABELS[section] : `${zone.materialId} · ${NARRATIVE_LABELS[section]}`,
  };
}

function NoZones() {
  return (
    <p className="text-sm text-muted-foreground">
      No material zones yet. Add them on the{" "}
      <a href="?tab=materials" className="underline underline-offset-2" onClick={(event) => goToTab(event, "tab=materials")}>
        Materials
      </a>{" "}
      tab.
    </p>
  );
}

export function DraftView({ projectId }: { projectId: string }) {
  const { data: report, error, isPending, refetch } = useReport(projectId);
  const draft = useDraftNarrative(projectId);
  const [rawRunId, setRawRunId] = useState<string | null>(null);

  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
        Building the report draft…
      </p>
    );
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-destructive">Could not build the report draft: {error.message}</span>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const { model, warnings } = report;
  const blockWarnings = (section: NarrativeSection, itemKey: string) =>
    warnings.filter((warning) => warning.section === section && warning.itemKey === itemKey);
  const field = (section: NarrativeSection, block: ReportDraftDto["model"]["executiveSummary"]["narrative"], label: string, hint?: string) => (
    <NarrativeField projectId={projectId} block={block} label={label} warnings={blockWarnings(section, block.itemKey)} hint={hint} />
  );

  const { lastRun } = report.draft;
  const running = draft.isPending || report.draft.running;
  const failed = !running && (draft.isError || lastRun?.status === "FAILED");
  const failureMessage = draft.error?.message ?? lastRun?.error ?? "The AI draft failed.";
  const hasAiDraft = report.draft.draftedAt !== null;
  const { readiness } = model.employeeReview;

  const runDraft = () =>
    draft.mutate(undefined, {
      onSuccess: ({ keptEdited }) =>
        toast.success(
          keptEdited > 0
            ? `Narrative drafted. ${keptEdited} text${keptEdited === 1 ? "" : "s"} you edited ${keptEdited === 1 ? "was" : "were"} kept; use Reset to AI draft to take the new text.`
            : "Narrative drafted. Check every text before the report is generated.",
        ),
    });

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="AI narrative draft" className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <FileTextIcon className="size-5" aria-hidden />
              Report draft
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Every fact, category and amount below is built in code from the matched data. AI writes only the narrative texts, as drafts
              for you to check and edit. Changes are saved when you leave a text field.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant="outline">{model.status}</Badge>
              {hasAiDraft && report.draft.draftedAt ? (
                <span className="text-xs text-muted-foreground">
                  Last AI draft {formatDateTime(report.draft.draftedAt)}
                  {lastRun ? ` · ${lastRun.model} · ${lastRun.promptVersion}` : ""}
                </span>
              ) : null}
            </div>
          </div>
          <Button onClick={runDraft} disabled={running}>
            {running ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <SparklesIcon aria-hidden />}
            {running ? "Drafting narrative…" : hasAiDraft ? "Draft again with AI" : "Draft narrative with AI"}
          </Button>
        </div>

        {running ? (
          <p className="text-sm text-muted-foreground" role="status">
            The AI is drafting the narrative from the report facts. This can take up to a minute; the texts below change when it is done.
          </p>
        ) : null}

        {failed ? (
          <div role="alert" className="flex flex-col gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p className="flex items-start gap-2">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                The AI draft did not complete: {failureMessage} Nothing from this attempt was saved; the texts below are unchanged.
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={runDraft}>
                Retry
              </Button>
              {lastRun?.hasRawResponse ? (
                <Button variant="ghost" size="sm" onClick={() => setRawRunId(lastRun.id)}>
                  View raw AI response
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {report.draft.outdated ? (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            The project data changed after the last AI draft. Check the texts against the facts below, or draft again; texts you edited are kept.
          </p>
        ) : null}

        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm", READINESS_CLASS[readiness.status])}>
          <span className="font-medium">{readiness.label}</span>
          {readiness.status === "BLOCKED" ? (
            <span className="text-muted-foreground">
              The draft can be written now, but its facts may still change.{" "}
              <a href="?tab=review&view=matching" className="underline underline-offset-2" onClick={(event) => goToTab(event, "tab=review&view=matching")}>
                Open Matching
              </a>
            </span>
          ) : null}
        </div>

        {warnings.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-950 dark:text-amber-100">
              <TriangleAlertIcon className="size-4" aria-hidden />
              {warnings.length} guardrail warning{warnings.length === 1 ? "" : "s"}: check {warnings.length === 1 ? "this text" : "these texts"} before
              the report is generated
            </p>
            <ul className="flex flex-col gap-0.5 text-xs">
              {warnings.map((warning, index) => {
                const target = warningTarget(report, warning);
                return (
                  <li key={`${target.id}-${warning.code}-${index}`}>
                    <a href={`#${target.id}`} className="underline underline-offset-2" onClick={(event) => scrollToId(event, target.id)}>
                      {target.label}
                    </a>{" "}
                    · {GUARD_TITLES[warning.code]}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <nav aria-label="Report sections" className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="text-muted-foreground underline-offset-2 hover:underline" onClick={(event) => scrollToId(event, section.id)}>
              {section.title}
            </a>
          ))}
        </nav>
      </section>

      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{model.notice}</p>

      <ReportSection id="report-project" title="Project information">
        <ProjectInformation model={model} />
        <a href="?tab=project" className="flex w-fit items-center gap-1 text-sm underline underline-offset-2" onClick={(event) => goToTab(event, "tab=project")}>
          <PencilLineIcon className="size-3.5" aria-hidden />
          Edit project information
        </a>
      </ReportSection>

      <ReportSection id="report-summary" title="Executive summary">
        {field("executiveSummary", model.executiveSummary.narrative, "Summary", "Paragraphs are separated by a blank line.")}
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Counts and cost scenario</p>
          <p className="rounded-md bg-muted px-3 py-2 text-sm">{model.executiveSummary.factsParagraph}</p>
          <p className="text-xs text-muted-foreground">Generated from the matched data and the cost scenario. Edit quantities, rates or lab results to change it.</p>
        </div>
      </ReportSection>

      <ReportSection
        id="report-findings"
        title="Findings and traceability"
        description="One record for every material zone. Every layer result and every sample ID is kept."
      >
        {model.findings.length === 0 ? <NoZones /> : null}
        {model.findings.map((finding) => (
          <article key={finding.zoneId} id={findingId(finding.zoneId)} className="flex scroll-mt-20 flex-col gap-3 rounded-lg border p-3 sm:p-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold">
                {finding.materialId} <span className="font-normal text-muted-foreground">{finding.description} · {finding.location}</span>
              </h3>
              <CategoryBadge category={finding.category} title={finding.categoryTitle} />
            </header>
            <FindingFacts finding={finding} />
            <GuardWarnings warnings={warnings.filter((warning) => warning.section === null && warning.itemKey === finding.zoneId)} />
            <div className="grid gap-4 md:grid-cols-2">
              {field("zoneInterpretation", finding.narrative.interpretation, NARRATIVE_LABELS.zoneInterpretation)}
              {field("zoneReason", finding.narrative.reason, NARRATIVE_LABELS.zoneReason)}
              {field("zoneUncertainty", finding.narrative.uncertainty, NARRATIVE_LABELS.zoneUncertainty)}
              {field("zoneFollowUp", finding.narrative.followUp, NARRATIVE_LABELS.zoneFollowUp)}
            </div>
          </article>
        ))}
      </ReportSection>

      <ReportSection
        id="report-recommendations"
        title="Recommendations for professional review"
        description="Draft actions that follow from the lab result and the field observation. The cost scenario does not prescribe removal."
      >
        {model.recommendations.length === 0 ? <NoZones /> : null}
        {model.recommendations.map((item) => (
          <div key={item.zoneId} className="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="font-semibold">{item.materialId}</span> {item.description} · {item.location}
                {item.sampleIds.length > 0 ? <span className="text-muted-foreground"> · {item.sampleIds.join(", ")}</span> : null}
              </p>
              <CategoryBadge category={item.category} title={item.categoryTitle} />
            </div>
            {field("recommendation", item.narrative, NARRATIVE_LABELS.recommendation)}
          </div>
        ))}
      </ReportSection>

      <ReportSection id="report-limitations" title="Scope limitations">
        <ul className="list-disc pl-4 text-sm">
          {model.scopeLimitations.items.map((item) => (
            <li key={`${item.kind}-${item.text}`}>{item.text}</li>
          ))}
        </ul>
        {model.scopeLimitations.projectLimitations !== "" ? (
          <p className="text-sm">
            <span className="font-medium">Limitations entered for the project:</span> {model.scopeLimitations.projectLimitations}
          </p>
        ) : null}
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {model.scopeLimitations.standing.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {field("limitations", model.scopeLimitations.narrative, NARRATIVE_LABELS.limitations, "One limitation per line.")}
      </ReportSection>

      <ReportSection id="report-costs" title="Illustrative cost scenario">
        <CostScenario model={model} />
      </ReportSection>

      <ReportSection id="report-exclusions" title="Assumptions and exclusions">
        <AssumptionsAndExclusions model={model} />
      </ReportSection>

      <ReportSection id="report-review" title="Employee review and appendices">
        <ReviewChecklistForm projectId={projectId} review={model.employeeReview} narrativeWarnings={warnings.length} />
        <p className="rounded-md bg-muted px-3 py-2 text-sm">{model.employeeReview.statusLine}</p>
        <p className="text-sm text-muted-foreground">{model.employeeReview.finalNote}</p>
        <Appendices model={model} />
      </ReportSection>

      <RawResponseDialog projectId={projectId} runId={rawRunId} onClose={() => setRawRunId(null)} />
    </div>
  );
}
