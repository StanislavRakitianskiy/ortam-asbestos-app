"use client";

import { CircleAlertIcon, CircleCheckIcon, FlagIcon, LoaderCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NeedsAttention, type MatchingNavigation } from "@/components/matching/needs-attention";
import { READINESS_CLASS, contentText, sourceLabel } from "@/components/matching/matching-format";
import { useAnalysis } from "@/components/matching/use-analysis";
import { ZoneTable } from "@/components/matching/zone-table";
import { RESULT_CLASS } from "@/components/lab-reports/lab-document-card";
import { CATEGORY_TITLES } from "@/domain/categories";
import { formatCad, formatResultLabel } from "@/domain/format";
import { CONTINGENCY_PERCENT } from "@/domain/rates";
import { CATEGORIES } from "@/domain/types";
import { cn } from "@/lib/utils";
import type { ProjectAnalysisDto } from "@/server/services/analysisService";

export function MatchingView({
  projectId,
  navigation,
  highlightZoneId,
}: {
  projectId: string;
  navigation: MatchingNavigation;
  highlightZoneId: string | null;
}) {
  const { data: analysis, error, isPending, refetch } = useAnalysis(projectId);

  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
        Matching lab results to material zones…
      </p>
    );
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-destructive">Could not load the matching: {error.message}</span>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ReadinessBanner analysis={analysis} />
      <NeedsAttention projectId={projectId} analysis={analysis} navigation={navigation} />
      {analysis.unmatchedSamples.length > 0 ? <UnmatchedSamples analysis={analysis} navigation={navigation} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Material zones</CardTitle>
          <CardDescription>
            Accepted lab rows are matched to zones by exact sample ID (trimmed, upper case). Every layer is kept; a detected layer makes the zone
            detected. Categories and costs are computed in code from these results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analysis.zones.length === 0 ? (
            <p className="text-sm text-muted-foreground">No material zones yet. Add them on the Materials tab.</p>
          ) : (
            <ZoneTable analysis={analysis} navigation={navigation} highlightZoneId={highlightZoneId} />
          )}
        </CardContent>
      </Card>
      <CostSummary analysis={analysis} />
    </div>
  );
}

function ReadinessBanner({ analysis }: { analysis: ProjectAnalysisDto }) {
  const { readiness } = analysis;
  const icon =
    readiness.status === "BLOCKED" ? (
      <CircleAlertIcon className="size-5 shrink-0 text-destructive" aria-hidden />
    ) : readiness.status === "DRAFT_WITH_FLAGS" ? (
      <FlagIcon className="size-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
    ) : (
      <CircleCheckIcon className="size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
    );
  const explanation =
    readiness.status === "BLOCKED"
      ? "Resolve each open item below or keep it flagged in the draft. The report can be generated once no blocking item is open."
      : readiness.status === "DRAFT_WITH_FLAGS"
        ? "The report can be generated. Flagged items stay visible in it and your notes go into its scope limitations."
        : "No blocking item is open. Items marked “No decision needed” are carried into the report as limitations.";
  const reports = new Set(analysis.results.map((row) => row.documentId)).size;

  return (
    <section
      aria-label="Report readiness"
      className={cn("flex items-start gap-3 rounded-xl border p-4", READINESS_CLASS[readiness.status])}
      data-readiness={readiness.status}
    >
      {icon}
      <div className="flex flex-col gap-1">
        <p className="font-semibold" role="status">
          {readiness.label}
        </p>
        <p className="text-sm text-muted-foreground">{explanation}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {analysis.zones.length} material zone{analysis.zones.length === 1 ? "" : "s"} · {analysis.results.length} accepted lab row
          {analysis.results.length === 1 ? "" : "s"} from {reports} lab report{reports === 1 ? "" : "s"} · categories{" "}
          {CATEGORIES.map((category) => `${category} ${analysis.zones.filter((zone) => zone.categorization.category === category).length}`).join(", ")}
        </p>
      </div>
    </section>
  );
}

function UnmatchedSamples({ analysis, navigation }: { analysis: ProjectAnalysisDto; navigation: MatchingNavigation }) {
  return (
    <Card aria-labelledby="unmatched-heading">
      <CardHeader>
        <CardTitle id="unmatched-heading">Unmatched lab samples</CardTitle>
        <CardDescription>
          Unmatched — not linked to any material zone. Nothing is linked automatically: a row joins a zone only after you correct its sample ID (with
          a reason), or after the sample ID is added to a zone on the Materials tab.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="text-xs [&_td]:px-1.5 [&_th]:px-1.5">
          <TableHeader>
            <TableRow>
              <TableHead>Lab sample</TableHead>
              <TableHead>Layer</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Register</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analysis.unmatchedSamples.flatMap((sample) =>
              sample.rows.map((row) => (
                <TableRow key={row.id} className="align-top">
                  <TableCell className="font-medium">{row.sampleId}</TableCell>
                  <TableCell className="whitespace-normal">{row.layer}</TableCell>
                  <TableCell>
                    <span className={cn("font-medium", RESULT_CLASS[row.resultLabel])}>{formatResultLabel(row.resultLabel)}</span>
                    {contentText(row) ? <span className="text-muted-foreground"> · {contentText(row)}</span> : null}
                  </TableCell>
                  <TableCell>
                    <Button variant="link" size="xs" className="h-auto px-0" onClick={() => navigation.openLabRow(row.documentId, row.id)}>
                      {sourceLabel(row)}
                    </Button>
                    <span className="block text-muted-foreground">{row.fileName}</span>
                  </TableCell>
                  <TableCell className="min-w-40 whitespace-normal">
                    <Badge className="bg-amber-500/15 text-amber-900 dark:text-amber-200">Unmatched</Badge>
                    <span className="mt-1 block">
                      {sample.similar.length > 0
                        ? `Similar ID in register: ${sample.similar.map((similar) => `${similar.sampleId} (${similar.zones.map((zone) => zone.materialId).join(", ")})`).join(", ")}`
                        : "No similar ID in the register."}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button size="xs" variant="outline" onClick={() => navigation.correctLabRow(row.documentId, row.id)}>
                      Correct sample ID
                    </Button>
                  </TableCell>
                </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CostSummary({ analysis }: { analysis: ProjectAnalysisDto }) {
  const { estimate } = analysis;
  const lines: [string, number, boolean?][] = [
    ["Removal subtotal", estimate.removalSubtotal],
    ["Replacement subtotal", estimate.replacementSubtotal],
    ["Zone subtotal", estimate.zoneSubtotal],
    ["Mobilization", estimate.mobilization],
    ["Professional assessment allowance", estimate.assessment],
    ["Direct subtotal", estimate.direct],
    [`Contingency (${CONTINGENCY_PERCENT}% of direct)`, estimate.contingency],
    ["Total before tax", estimate.total, true],
  ];
  const zoneExclusions = estimate.exclusions.filter((exclusion) => exclusion.reason !== "FIXED");
  const fixed = estimate.exclusions.filter((exclusion) => exclusion.reason === "FIXED");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost scenario</CardTitle>
        <CardDescription>
          Fictional removal and replacement scenario in CAD, before tax, computed in code from the rate card. Only detected zones with a known quantity
          and a rate in the zone&apos;s unit are priced. It is not a contractor quotation.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
          {lines.map(([label, cents, strong]) => (
            <div key={label} className={cn("contents", strong && "font-semibold")}>
              <dt className={cn(strong && "border-t pt-1")}>{label}</dt>
              <dd className={cn("text-right tabular-nums", strong && "border-t pt-1")}>{formatCad(cents)}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">Exclusions</p>
          {zoneExclusions.length > 0 ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs">
              {zoneExclusions.map((exclusion) => (
                <li key={`${exclusion.zoneId}-${exclusion.reason}`}>{exclusion.text}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">Always excluded: {fixed.map((exclusion) => exclusion.text).join(", ")}.</p>
          <p className="text-xs text-muted-foreground">
            Category guide: {CATEGORIES.map((category) => `${category} ${CATEGORY_TITLES[category]}`).join(" · ")}.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
