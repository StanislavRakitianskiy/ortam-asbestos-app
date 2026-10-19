"use client";

import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MatchingNavigation } from "@/components/matching/needs-attention";
import {
  CATEGORY_CLASS,
  LAYER_STATUS_CLASS,
  LAYER_STATUS_LABELS,
  ZONE_STATUS_CLASS,
  ZONE_STATUS_LABELS,
  contentText,
  costText,
  sourceLabel,
} from "@/components/matching/matching-format";
import type { ZoneAnalysis } from "@/domain/analysis";
import { CATEGORY_TITLES } from "@/domain/categories";
import { formatQuantity, formatResultLabel } from "@/domain/format";
import type { LayerMatch, SampleMatch } from "@/domain/matching";
import { cn } from "@/lib/utils";
import type { ProjectAnalysisDto } from "@/server/services/analysisService";

export const zoneRowId = (zoneId: string) => `matching-zone-${zoneId}`;

export function ZoneTable({
  analysis,
  navigation,
  highlightZoneId,
}: {
  analysis: ProjectAnalysisDto;
  navigation: MatchingNavigation;
  highlightZoneId: string | null;
}) {
  const openIssues = (zone: ZoneAnalysis) =>
    analysis.issues.filter((found) => zone.issueKeys.includes(found.key) && found.state !== "RESOLVED").length;

  return (
    <Table className="text-xs [&_td]:px-1.5 [&_th]:px-1.5">
      <TableHeader>
        <TableRow>
          <TableHead>Zone</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Samples and layers</TableHead>
          <TableHead>Zone status</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Cost (CAD)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {analysis.zones.map((entry) => {
          const { zone } = entry;
          const cost = costText(entry.cost);
          const issueCount = openIssues(entry);
          return (
            <TableRow
              key={zone.id}
              id={zoneRowId(zone.id)}
              className={cn("scroll-mt-24 align-top transition-colors", highlightZoneId === zone.id && "bg-amber-500/15 hover:bg-amber-500/15")}
            >
              <TableCell className="min-w-28 whitespace-normal">
                <span className="text-sm font-semibold">{zone.materialId}</span>
                <span className="block text-muted-foreground">{zone.description}</span>
                {issueCount > 0 ? (
                  <span className="mt-1 block text-amber-800 dark:text-amber-300">
                    {issueCount} item{issueCount === 1 ? "" : "s"} in Needs attention
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="min-w-28 whitespace-normal">
                {zone.floor}
                <span className="block text-muted-foreground">{zone.location}</span>
              </TableCell>
              <TableCell className="min-w-64 whitespace-normal">
                <Samples samples={entry.samples} accessible={zone.accessible} navigation={navigation} />
              </TableCell>
              <TableCell>
                <Badge className={ZONE_STATUS_CLASS[entry.zoneStatus]}>{ZONE_STATUS_LABELS[entry.zoneStatus]}</Badge>
              </TableCell>
              <TableCell className="min-w-56 whitespace-normal">
                <div className="flex items-center gap-1.5">
                  <Badge className={cn("font-semibold", CATEGORY_CLASS[entry.categorization.category])}>{entry.categorization.category}</Badge>
                  <span className="font-medium">{CATEGORY_TITLES[entry.categorization.category]}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{entry.categorization.reasonText}</p>
              </TableCell>
              <TableCell className={cn("text-right tabular-nums", zone.quantity === null && "text-amber-800 dark:text-amber-300")}>
                {formatQuantity(zone.quantity, zone.unit)}
              </TableCell>
              <TableCell className="min-w-32 text-right whitespace-normal">
                {entry.cost.status === "PRICED" ? (
                  <>
                    <span className="text-sm font-semibold tabular-nums">{cost.main}</span>
                    <span className="block text-muted-foreground tabular-nums">Priced · {cost.detail}</span>
                  </>
                ) : (
                  <>
                    <span className={cn("font-medium", entry.cost.status === "NOT_PRICED" ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
                      {cost.main}
                    </span>
                    <span className="block text-muted-foreground">{cost.detail}</span>
                  </>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Samples({ samples, accessible, navigation }: { samples: SampleMatch[]; accessible: boolean; navigation: MatchingNavigation }) {
  if (samples.length === 0) {
    return <span className="text-muted-foreground">{accessible ? "No sample taken" : "Inaccessible; no sample taken"}</span>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {samples.map((sample) => (
        <li key={sample.sampleId}>
          <span className="font-medium">{sample.sampleId}</span>
          {sample.layers.length === 0 ? (
            <span className="text-amber-800 dark:text-amber-300"> · awaiting lab result</span>
          ) : (
            <ul className="mt-0.5 flex flex-col gap-0.5 border-l pl-2">
              {sample.layers.map((layer) => (
                <Layer key={layer.layerKey} layer={layer} navigation={navigation} />
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One layer: its result and the lab row(s) behind it. A conflicting layer lists each source with its own result. */
function Layer({ layer, navigation }: { layer: LayerMatch; navigation: MatchingNavigation }) {
  const sourceButton = (row: LayerMatch["results"][number]) => (
    <Button key={row.id} variant="link" size="xs" className="h-auto px-0.5" onClick={() => navigation.openLabRow(row.documentId, row.id)}>
      {sourceLabel(row)}
    </Button>
  );
  if (layer.status === "CONFLICT") {
    return (
      <li>
        {layer.layer} — <span className={cn("font-medium", LAYER_STATUS_CLASS.CONFLICT)}>{LAYER_STATUS_LABELS.CONFLICT}</span>
        <ul className="flex flex-col">
          {layer.results.map((row) => (
            <li key={row.id}>
              {formatResultLabel(row.resultLabel)}
              {contentText(row) ? ` ${contentText(row)}` : ""} · {sourceButton(row)}
            </li>
          ))}
        </ul>
      </li>
    );
  }
  const content = contentText(layer.results[0]);
  return (
    <li>
      {layer.layer} — <span className={cn("font-medium", LAYER_STATUS_CLASS[layer.status])}>{LAYER_STATUS_LABELS[layer.status]}</span>
      {content ? <span className="text-muted-foreground"> {content}</span> : null} ·{" "}
      {layer.results.map((row, index) => (
        <Fragment key={row.id}>
          {index > 0 ? ", " : null}
          {sourceButton(row)}
        </Fragment>
      ))}
    </li>
  );
}
