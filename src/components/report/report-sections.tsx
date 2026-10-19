"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CATEGORY_CLASS, LAYER_STATUS_CLASS, ZONE_STATUS_CLASS, ZONE_STATUS_LABELS } from "@/components/matching/matching-format";
import { formatCad } from "@/domain/format";
import type { CostRow, DecisionEntry, ReportModel, ZoneFinding } from "@/domain/reportModel";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** Read-only parts of the report draft. Everything here is built in code from the matched data. */

export function ReportSection({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-20 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <header className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** A label and a value in the two-column record tables of the master. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b py-2 last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function ProjectInformation({ model }: { model: ReportModel }) {
  return (
    <dl>
      {model.projectInformation.rows.map((row) => (
        <Row key={row.field} label={row.field}>
          {row.field === "Status" ? <Badge variant="outline">{row.value}</Badge> : row.value}
        </Row>
      ))}
    </dl>
  );
}

export function CategoryBadge({ category, title }: { category: ZoneFinding["category"]; title: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge className={cn("font-semibold", CATEGORY_CLASS[category])}>{category}</Badge>
      <span className="text-sm font-medium">{title}</span>
    </span>
  );
}

const yesNo = (value: boolean) => (value ? "Yes" : "No");

/** The generated rows of one zone's findings record (master: Findings and traceability). */
export function FindingFacts({ finding }: { finding: ZoneFinding }) {
  const { fieldEvidence: field } = finding;
  return (
    <dl>
      <Row label="Material zone and location">
        {finding.materialId} · {finding.floor} · {finding.location} · {finding.description}
      </Row>
      <Row label="Field evidence">
        Condition {field.condition} · Quantity{" "}
        <span className={cn(field.quantity === null && "font-medium text-amber-800 dark:text-amber-300")}>{field.quantityText}</span> · Planned
        disturbance {yesNo(field.plannedDisturbance).toLowerCase()} · Accessible {yesNo(field.accessible).toLowerCase()}
        {field.notes.trim() !== "" ? <span className="mt-0.5 block text-xs text-muted-foreground">Employee notes: {field.notes}</span> : null}
      </Row>
      <Row label="Lab evidence and result detail">
        {finding.samples.length === 0 ? (
          <span className="text-muted-foreground">{field.accessible ? "No sample taken." : "Inaccessible; no sample taken."}</span>
        ) : (
          <ul className="flex flex-col gap-2">
            {finding.samples.map((sample) => (
              <li key={sample.sampleId}>
                <span className="font-medium">{sample.sampleId}</span>
                {sample.layers.length === 0 ? (
                  <span className="text-amber-800 dark:text-amber-300"> · awaiting lab result</span>
                ) : (
                  <ul className="mt-0.5 flex flex-col gap-1 border-l pl-2">
                    {sample.layers.map((layer) => (
                      <li key={layer.layer}>
                        {layer.layer}: <span className={cn("font-medium", LAYER_STATUS_CLASS[layer.status])}>{layer.statusText}</span>
                        {[layer.asbestosType, layer.percentageRaw].filter(Boolean).length > 0 ? (
                          <span className="text-muted-foreground"> · {[layer.asbestosType, layer.percentageRaw].filter(Boolean).join(" · ")}</span>
                        ) : null}
                        {layer.sources.map((source) => (
                          <span key={source.labResultId} className="block text-xs text-muted-foreground">
                            {source.labReportId} · {source.fileName} p.{source.page}
                            {layer.status === "CONFLICT" ? ` · ${source.resultLabel}` : ""} · “{source.quote}”
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Row label="Interpretation">
        <Badge className={ZONE_STATUS_CLASS[finding.zoneStatus]}>{finding.interpretation}</Badge>
      </Row>
      <Row label="Review action">
        <CategoryBadge category={finding.category} title={finding.categoryTitle} />
        <span className="mt-1 block text-muted-foreground">{finding.reasonText}</span>
      </Row>
      <Row label="Missing information">
        {finding.uncertainty.length === 0 ? (
          <span className="text-muted-foreground">None recorded.</span>
        ) : (
          <ul className="list-disc pl-4">
            {finding.uncertainty.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </Row>
      <Row label="Cost scenario">
        <span className={cn(finding.cost.status === "NOT_PRICED" && "font-medium text-amber-800 dark:text-amber-300")}>{finding.cost.text}</span>
      </Row>
    </dl>
  );
}

const rateText = (rate: number | null, unit: CostRow["unit"]) => (rate === null ? "" : `CAD ${formatCad(rate)}/${unit}`);

export function CostScenario({ model }: { model: ReportModel }) {
  const { lines, summary, scenarioText } = model.costScenario;
  const notPriced = <span className="font-medium text-amber-800 dark:text-amber-300">Not priced</span>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">{scenarioText}</p>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No detected zone, so the scenario has no lines.</p>
      ) : (
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>Zone</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Removal</TableHead>
              <TableHead className="text-right">Replacement</TableHead>
              <TableHead className="text-right">Line total (CAD)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.zoneId} className="align-top">
                <TableCell className="whitespace-normal">
                  <span className="font-medium">{line.materialId}</span> {line.description}
                  {line.notPricedText ? <span className="block text-xs text-amber-800 dark:text-amber-300">{line.notPricedText}</span> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{line.quantityText}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.removalAmount === null ? notPriced : formatCad(line.removalAmount)}
                  <span className="block text-xs text-muted-foreground">{rateText(line.removalRate, line.unit)}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.replacementAmount === null ? notPriced : formatCad(line.replacementAmount)}
                  <span className="block text-xs text-muted-foreground">{rateText(line.replacementRate, line.unit)}</span>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{line.lineTotal === null ? notPriced : formatCad(line.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Table className="max-w-xl text-sm">
        <TableHeader>
          <TableRow>
            <TableHead>Summary</TableHead>
            <TableHead className="text-right">CAD</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="whitespace-normal">
              Measured zone subtotal
              <span className="block text-xs text-muted-foreground">
                Removal {formatCad(summary.removalSubtotal)} + replacement {formatCad(summary.replacementSubtotal)}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatCad(summary.zoneSubtotal)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Mobilization once</TableCell>
            <TableCell className="text-right tabular-nums">{formatCad(summary.mobilization)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Professional assessment allowance once</TableCell>
            <TableCell className="text-right tabular-nums">{formatCad(summary.assessment)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Direct subtotal</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatCad(summary.direct)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Contingency at {summary.contingencyPercent} percent</TableCell>
            <TableCell className="text-right tabular-nums">{formatCad(summary.contingency)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-semibold">Illustrative total before tax</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{formatCad(summary.total)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {summary.pricedZones === 0 ? (
        <p className="text-xs text-muted-foreground">Mobilization and the assessment allowance are added only when at least one zone is priced.</p>
      ) : null}
    </div>
  );
}

export function AssumptionsAndExclusions({ model }: { model: ReportModel }) {
  const { assumptions, exclusions } = model.assumptionsAndExclusions;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h3 className="mb-1.5 text-sm font-medium">Assumptions</h3>
        <ul className="list-disc pl-4 text-sm">
          {assumptions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-1.5 text-sm font-medium">Exclusions</h3>
        <ul className="list-disc pl-4 text-sm">
          {exclusions.map((exclusion) => (
            <li key={`${exclusion.reason}-${exclusion.materialId ?? exclusion.text}`} className={cn(exclusion.materialId !== null && "text-amber-900 dark:text-amber-200")}>
              {exclusion.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const DECISION_STATE_TEXT: Record<DecisionEntry["state"], string> = {
  CURRENT: "Applies",
  OUTDATED: "Outdated (the issue now refers to other evidence)",
  AUTO_CLEARED: "Auto-cleared (the data was corrected)",
};

function Appendix({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <details className="rounded-lg border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">
        {title} <span className="text-muted-foreground tabular-nums">({count})</span>
      </summary>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </details>
  );
}

export function Appendices({ model }: { model: ReportModel }) {
  const { corrections, decisions, sampleRegister, labSources } = model.appendices;
  return (
    <div className="flex flex-col gap-2">
      <Appendix title="Employee corrections" count={corrections.length}>
        {corrections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lab data was corrected.</p>
        ) : (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Lab row or report</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {corrections.map((entry) => (
                <TableRow key={entry.id} className="align-top">
                  <TableCell className="whitespace-normal">{entry.target}</TableCell>
                  <TableCell>{entry.field}</TableCell>
                  <TableCell className="whitespace-normal">
                    {entry.from} → {entry.to}
                  </TableCell>
                  <TableCell className="whitespace-normal">{entry.reason}</TableCell>
                  <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Appendix>
      <Appendix title="Review issue decisions" count={decisions.length}>
        {decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No issue needed a decision.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {decisions.map((entry) => (
              <li key={`${entry.issueKey}-${entry.state}`}>
                <span className="font-medium">{entry.decision === "FLAGGED" ? "Kept flagged in draft" : "Resolved"}</span> ·{" "}
                {DECISION_STATE_TEXT[entry.state]} · {formatDateTime(entry.decidedAt)}
                <span className="block text-muted-foreground">{entry.message}</span>
                <span className="block">Note: {entry.note}</span>
              </li>
            ))}
          </ul>
        )}
      </Appendix>
      <Appendix title="Sample register" count={sampleRegister.length}>
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Sample</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Layer results</TableHead>
              <TableHead>Lab reports</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sampleRegister.map((row) => (
              <TableRow key={`${row.sampleId}-${row.materialId ?? "unmatched"}`}>
                <TableCell className="font-medium">{row.sampleId}</TableCell>
                <TableCell>{row.materialId ?? "—"}</TableCell>
                <TableCell>{row.location ?? "Not in the register"}</TableCell>
                <TableCell>{row.status === "UNMATCHED" ? "Unmatched" : ZONE_STATUS_LABELS[row.status]}</TableCell>
                <TableCell className="text-right tabular-nums">{row.layerResults}</TableCell>
                <TableCell>{row.labReportIds.join(", ") || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Appendix>
      <Appendix title="Lab sources" count={labSources.length}>
        <div className="flex flex-col gap-3">
          {labSources.map((document) => (
            <div key={document.documentId}>
              <p className="text-sm font-medium">
                {document.labReportId ?? "No report ID"} · {document.fileName}
              </p>
              <p className="text-xs text-muted-foreground">
                {[document.labName, document.issuedDate].filter(Boolean).join(" · ")}
                {document.labName || document.issuedDate ? " · " : ""}
                {document.pageCount} page{document.pageCount === 1 ? "" : "s"} · SHA-256 {document.sha256.slice(0, 12)}…
                {document.status === "ACCEPTED" ? "" : ` · ${document.status.toLowerCase().replace("_", " ")}: rows not used`}
              </p>
              {document.rows.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                  {document.rows.map((row) => (
                    <li key={row.labResultId}>
                      <span className="font-medium">{row.sampleId}</span> {row.layer} · p.{row.page} · “{row.quote}”
                      {row.labNote ? <span className="block text-muted-foreground">Lab note: {row.labNote}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </Appendix>
      <p className="text-sm text-muted-foreground">Floor plan: no plan is attached in this version.</p>
    </div>
  );
}
