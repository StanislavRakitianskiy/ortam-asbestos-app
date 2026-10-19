// End-to-end check of the supplied demo project against the "Golden expectations" in CLAUDE.md.
// Run with `npm run verify` after LAB-A, LAB-B and LAB-C are accepted in ORTAM-DEMO-001 and the report is generated.
//
// 1. Lab reports: the three supplied PDFs (by SHA-256) are uploaded to ORTAM-DEMO-001 and ACCEPTED.
// 2. Data: status, category and cost of every zone and the cost totals, as the app computes them from the database
//    (the same ReportModel the report is rendered from), compared with the table and totals line in CLAUDE.md.
// 3. Files: the latest READY revision's Word and PDF files print the same revision, snapshot and total, and that total
//    is the revision snapshot's total and the golden one.
// Prints what it compared and exits with code 1 on any difference or missing precondition. It only reads.
//
// Executed by Node's built-in TypeScript support; scripts/ts-hooks.mjs resolves the app's `@/` imports.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";
import { formatCad } from "@/domain/format";
import type { ReportModel } from "@/domain/reportModel";
import { CATEGORIES, ZONE_STATUSES, type Category, type Cents, type ZoneStatus } from "@/domain/types";
import { getDb } from "@/server/db";
import { extractPages } from "@/server/pdf/extractPages";
import { buildSnapshot, loadReportTemplate, parseSnapshot } from "@/server/report/snapshot";
import { loadReportModel } from "@/server/services/reportService";
import { revisionService } from "@/server/services/revisionService";
import { sha256Hex } from "@/server/storage/uploads";

export const PROJECT_CODE = "ORTAM-DEMO-001";
export const CLAUDE_MD = "CLAUDE.md";
export const SUPPLIED_LAB_REPORTS = ["LAB-A_fictional_lab_report.pdf", "LAB-B_fictional_lab_report.pdf", "LAB-C_fictional_lab_report.pdf"].map(
  (name) => path.join("fixtures", name),
);

export class GoldenParseError extends Error {
  constructor(message: string) {
    super(`CLAUDE.md golden expectations: ${message}`);
    this.name = "GoldenParseError";
  }
}

// ---------------------------------------------------------------- golden expectations

/** How a zone appears in the cost scenario, written the way CLAUDE.md writes it. */
export type CostOutcome = { kind: "PRICED"; cents: Cents } | { kind: "NO_COST" } | { kind: "NOT_PRICED"; text: string };

export type GoldenZone = { materialId: string; status: ZoneStatus; category: Category; cost: CostOutcome };

export const TOTAL_KEYS = ["removalSubtotal", "replacementSubtotal", "zoneSubtotal", "direct", "contingency", "total"] as const;
export type TotalKey = (typeof TOTAL_KEYS)[number];
export type GoldenTotals = Record<TotalKey, Cents>;

export type Golden = { zones: GoldenZone[]; totals: GoldenTotals };

const TOTAL_LABELS: Record<TotalKey, string> = {
  removalSubtotal: "Removal subtotal",
  replacementSubtotal: "Replacement subtotal",
  zoneSubtotal: "Zone subtotal",
  direct: "Direct subtotal",
  contingency: "Contingency",
  total: "Total before tax",
};

/** "3840.00" or "3,840.00" → 384000. Integer arithmetic only. */
export function parseCents(text: string): Cents {
  const match = /^(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/.exec(text.trim());
  if (match === null) throw new GoldenParseError(`"${text}" is not an amount with two decimals.`);
  return Number(match[1].replace(/,/g, "")) * 100 + Number(match[2]);
}

function parseCost(cell: string, materialId: string): CostOutcome {
  const amount = /^(\d[\d,]*\.\d{2})\b/.exec(cell);
  if (amount !== null) return { kind: "PRICED", cents: parseCents(amount[1]) };
  if (/^no cost line$/i.test(cell)) return { kind: "NO_COST" };
  if (/^Not priced \([^)]+\)$/.test(cell)) return { kind: "NOT_PRICED", text: cell };
  throw new GoldenParseError(`the cost of ${materialId} ("${cell}") is not an amount, "no cost line" or "Not priced (…)".`);
}

/** Reads the "## Golden expectations" table and its totals line ("Zone subtotal … · total … CAD."). */
export function parseGolden(markdown: string): Golden {
  const start = markdown.search(/^## Golden expectations/m);
  if (start === -1) throw new GoldenParseError('no "## Golden expectations" section.');
  const rest = markdown.slice(start).split("\n").slice(1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const section = end === -1 ? rest : rest.slice(0, end);

  const zones: GoldenZone[] = [];
  for (const line of section) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells[0] === "Zone" || cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    if (cells.length !== 4) throw new GoldenParseError(`row "${line}" does not have 4 columns.`);
    const [materialId, status, category, cost] = cells;
    if (!(ZONE_STATUSES as readonly string[]).includes(status)) throw new GoldenParseError(`${materialId} has an unknown status "${status}".`);
    if (!(CATEGORIES as readonly string[]).includes(category)) throw new GoldenParseError(`${materialId} has an unknown category "${category}".`);
    zones.push({ materialId, status: status as ZoneStatus, category: category as Category, cost: parseCost(cost, materialId) });
  }
  if (zones.length === 0) throw new GoldenParseError("the table has no zone rows.");

  const totalsLine = section.find((line) => line.startsWith("Zone subtotal"));
  if (totalsLine === undefined) throw new GoldenParseError('no line starting with "Zone subtotal".');
  const amount = (pattern: RegExp, label: string) => {
    const match = pattern.exec(totalsLine);
    if (match === null) throw new GoldenParseError(`the totals line has no ${label}.`);
    return parseCents(match[1]);
  };
  const AMOUNT = String.raw`(\d[\d,]*\.\d{2})`;
  return {
    zones,
    totals: {
      zoneSubtotal: amount(new RegExp(`^Zone subtotal ${AMOUNT}`), "zone subtotal"),
      removalSubtotal: amount(new RegExp(`removal ${AMOUNT}`), "removal subtotal"),
      replacementSubtotal: amount(new RegExp(`replacement ${AMOUNT}`), "replacement subtotal"),
      direct: amount(new RegExp(`direct ${AMOUNT}`), "direct subtotal"),
      contingency: amount(new RegExp(`contingency ${AMOUNT}`), "contingency"),
      total: amount(new RegExp(`total ${AMOUNT} CAD`), "total"),
    },
  };
}

// ---------------------------------------------------------------- comparison

/** A cost outcome as one line of text: "3,840.00", "no cost line" or "Not priced (quantity unknown)". */
export function costText(cost: CostOutcome): string {
  if (cost.kind === "PRICED") return formatCad(cost.cents);
  return cost.kind === "NO_COST" ? "no cost line" : cost.text;
}

function actualCost(finding: ReportModel["findings"][number]): CostOutcome {
  switch (finding.cost.status) {
    case "PRICED":
      return finding.cost.lineTotal === null ? { kind: "NOT_PRICED", text: "priced without a line total" } : { kind: "PRICED", cents: finding.cost.lineTotal };
    case "NO_COST":
      return { kind: "NO_COST" };
    case "NOT_PRICED":
      return { kind: "NOT_PRICED", text: finding.cost.text };
  }
}

export type ZoneCheck = {
  materialId: string;
  actual: { status: string; category: string; cost: string } | null;
  expected: { status: string; category: string; cost: string } | null;
  problems: string[];
};

/** Every zone of the model and of the golden table, in golden order, then any zone the golden table does not list. */
export function compareZones(golden: readonly GoldenZone[], model: ReportModel): ZoneCheck[] {
  const linesByZone = new Map<string, number>();
  for (const line of model.costScenario.lines) linesByZone.set(line.materialId, (linesByZone.get(line.materialId) ?? 0) + 1);
  const findings = new Map(model.findings.map((finding) => [finding.materialId, finding]));
  const order = [...golden.map((zone) => zone.materialId), ...model.findings.map((finding) => finding.materialId)];

  return [...new Set(order)].map((materialId): ZoneCheck => {
    const expectedZone = golden.find((zone) => zone.materialId === materialId);
    const finding = findings.get(materialId);
    const expected = expectedZone === undefined ? null : { status: expectedZone.status, category: expectedZone.category, cost: costText(expectedZone.cost) };
    const actual = finding === undefined ? null : { status: finding.zoneStatus, category: finding.category, cost: costText(actualCost(finding)) };
    const problems: string[] = [];
    if (actual === null) problems.push("missing from the project");
    if (expected === null) problems.push("not in the golden table");
    if (actual !== null && expected !== null) {
      if (actual.status !== expected.status) problems.push(`status ${actual.status}, expected ${expected.status}`);
      if (actual.category !== expected.category) problems.push(`category ${actual.category}, expected ${expected.category}`);
      if (actual.cost !== expected.cost) problems.push(`cost ${actual.cost}, expected ${expected.cost}`);
    }
    const lines = linesByZone.get(materialId) ?? 0;
    if (lines > 1) problems.push(`${lines} cost lines; a zone is charged once`);
    if (expectedZone?.cost.kind === "NO_COST" && lines > 0) problems.push("has a cost line; a not-detected zone has none");
    return { materialId, actual, expected, problems };
  });
}

export type TotalCheck = { key: TotalKey; label: string; actual: Cents; expected: Cents; ok: boolean };

export function compareTotals(golden: GoldenTotals, summary: ReportModel["costScenario"]["summary"]): TotalCheck[] {
  return TOTAL_KEYS.map((key) => ({ key, label: TOTAL_LABELS[key], actual: summary[key], expected: golden[key], ok: summary[key] === golden[key] }));
}

// ---------------------------------------------------------------- report files

/** The body text of a .docx, one line per paragraph. */
export function docxText(docx: Uint8Array): string {
  const xml = new PizZip(docx).file("word/document.xml")?.asText();
  if (xml === undefined) throw new Error("The Word file has no word/document.xml.");
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((paragraph) => [...paragraph[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join(""))
    .join("\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function pdfText(pdf: Uint8Array): Promise<string> {
  const { pages } = await extractPages(pdf);
  return pages.map((page) => page.lines.join("\n")).join("\n");
}

/** What a report file prints about itself: every "total before tax" amount, the revision number and the snapshot. */
export type PrintedFacts = { totals: string[]; revision: number | null; snapshot: string | null };

export function printedFacts(text: string): PrintedFacts {
  const revision = /\bRevision\s+(\d+)\b/.exec(text);
  return {
    totals: [...text.matchAll(/total before tax\s+(?:CAD\s+)?(\d{1,3}(?:,\d{3})*\.\d{2})/gi)].map((match) => match[1]),
    revision: revision === null ? null : Number(revision[1]),
    snapshot: /\bSnapshot\s+([0-9a-f]{12})\b/.exec(text)?.[1] ?? null,
  };
}

/** Problems with one file: no total, totals that disagree, or a total, revision or snapshot other than expected. */
export function checkPrinted(label: string, facts: PrintedFacts, expected: { total: string; revision: number; snapshot: string }): string[] {
  const problems: string[] = [];
  const distinct = [...new Set(facts.totals)];
  if (distinct.length === 0) problems.push(`${label}: no "total before tax" amount found.`);
  else if (distinct.length > 1) problems.push(`${label}: prints different totals: ${distinct.join(", ")}.`);
  else if (distinct[0] !== expected.total) problems.push(`${label}: total ${distinct[0]}, the revision snapshot says ${expected.total}.`);
  if (facts.revision !== expected.revision) problems.push(`${label}: prints revision ${facts.revision ?? "none"}, expected ${expected.revision}.`);
  if (facts.snapshot !== expected.snapshot) problems.push(`${label}: prints snapshot ${facts.snapshot ?? "none"}, expected ${expected.snapshot}.`);
  return problems;
}

// ---------------------------------------------------------------- output

const pad = (text: string, width: number) => text.padEnd(width);

function zoneTable(checks: readonly ZoneCheck[]): string[] {
  const header = `${pad("Zone", 6)}${pad("Status", 14)}${pad("Cat.", 6)}${pad("Cost (CAD)", 32)}${pad("Expected", 50)}Check`;
  const rows = checks.map((check) => {
    const actual = check.actual ?? { status: "—", category: "—", cost: "—" };
    const expected = check.expected === null ? "—" : `${check.expected.status} ${check.expected.category} ${check.expected.cost}`;
    const verdict = check.problems.length === 0 ? "ok" : `MISMATCH: ${check.problems.join("; ")}`;
    return `${pad(check.materialId, 6)}${pad(actual.status, 14)}${pad(actual.category, 6)}${pad(actual.cost, 32)}${pad(expected, 50)}${verdict}`;
  });
  return [header, "-".repeat(header.length), ...rows];
}

function totalsTable(checks: readonly TotalCheck[]): string[] {
  const header = `${pad("Totals (CAD)", 24)}${pad("Actual", 14)}${pad("Expected", 14)}Check`;
  const rows = checks.map(
    (check) => `${pad(check.label, 24)}${pad(formatCad(check.actual), 14)}${pad(formatCad(check.expected), 14)}${check.ok ? "ok" : "MISMATCH"}`,
  );
  return [header, "-".repeat(header.length), ...rows];
}

// ---------------------------------------------------------------- main

async function main(): Promise<number> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: rely on variables from the shell.
  }
  const problems: string[] = [];
  const say = (line = "") => console.log(line);
  const golden = parseGolden(await readFile(CLAUDE_MD, "utf8"));
  const db = getDb();

  try {
    const project = await db.project.findUnique({ where: { code: PROJECT_CODE }, select: { id: true } });
    if (project === null) {
      console.error(`Project ${PROJECT_CODE} does not exist. Enter it from the field notes (or npm run db:seed) and upload the lab reports.`);
      return 1;
    }
    say(`${PROJECT_CODE} · golden check against ${CLAUDE_MD}`);
    say();

    // 1. The three supplied lab reports are uploaded and accepted.
    const documents = await db.labDocument.findMany({ where: { projectId: project.id }, select: { fileName: true, sha256: true, status: true } });
    say("Lab reports");
    for (const file of SUPPLIED_LAB_REPORTS) {
      const sha256 = sha256Hex(new Uint8Array(await readFile(file)));
      const uploaded = documents.find((document) => document.sha256 === sha256);
      const status = uploaded?.status ?? "NOT UPLOADED";
      say(`  ${pad(path.basename(file), 36)}${pad(status, 14)}${status === "ACCEPTED" ? "ok" : "NOT ACCEPTED"}`);
      if (status !== "ACCEPTED") problems.push(`${path.basename(file)} is ${status === "NOT UPLOADED" ? "not uploaded" : status}; accept it in Review first.`);
    }
    for (const document of documents.filter((candidate) => candidate.status !== "ACCEPTED")) {
      if (!problems.some((problem) => problem.startsWith(document.fileName))) {
        problems.push(`${document.fileName} is ${document.status}; every lab report of the project must be accepted.`);
      }
    }
    say();

    // 2. Zones and totals from the database.
    const model = await db.$transaction((tx) => loadReportModel(tx, project.id));
    const zoneChecks = compareZones(golden.zones, model);
    const totalChecks = compareTotals(golden.totals, model.costScenario.summary);
    zoneTable(zoneChecks).forEach((line) => say(line));
    say();
    totalsTable(totalChecks).forEach((line) => say(line));
    say();
    for (const check of zoneChecks) problems.push(...check.problems.map((problem) => `${check.materialId}: ${problem}.`));
    for (const check of totalChecks.filter((candidate) => !candidate.ok)) {
      problems.push(`${check.label}: ${formatCad(check.actual)}, expected ${formatCad(check.expected)}.`);
    }

    // 3. The latest READY revision: Word and PDF print the same facts.
    const revision = await db.reportRevision.findFirst({
      where: { projectId: project.id, status: "READY" },
      orderBy: { number: "desc" },
      select: { id: true, number: true, snapshotHash: true, snapshotJson: true },
    });
    if (revision === null) {
      problems.push("There is no READY report revision. Generate the report in the Preview tab first.");
    } else {
      const template = await loadReportTemplate();
      const current = buildSnapshot(model, template.sha256).hash === revision.snapshotHash;
      const snapshotTotal = formatCad(parseSnapshot(revision.snapshotJson).model.costScenario.summary.total);
      const expected = { total: snapshotTotal, revision: revision.number, snapshot: revision.snapshotHash.slice(0, 12) };
      const files = revisionService({ db });
      const docx = printedFacts(docxText((await files.getFile(revision.id, "docx")).bytes));
      const pdf = printedFacts(await pdfText((await files.getFile(revision.id, "pdf")).bytes));

      say(`Latest READY revision ${revision.number} · snapshot ${expected.snapshot} · ${current ? "current" : "OUTDATED (the data changed after it)"}`);
      say(`  ${pad("Snapshot total", 16)}${snapshotTotal}`);
      say(`  ${pad("Word total", 16)}${pad(docx.totals.join(", ") || "none", 24)}revision ${docx.revision ?? "?"} · snapshot ${docx.snapshot ?? "?"}`);
      say(`  ${pad("PDF total", 16)}${pad(pdf.totals.join(", ") || "none", 24)}revision ${pdf.revision ?? "?"} · snapshot ${pdf.snapshot ?? "?"}`);
      say();
      problems.push(...checkPrinted("Word file", docx, expected), ...checkPrinted("PDF file", pdf, expected));
      if (snapshotTotal !== formatCad(golden.totals.total)) {
        problems.push(`Revision ${revision.number} total ${snapshotTotal}, golden total ${formatCad(golden.totals.total)}. Regenerate the report.`);
      }
      if (!current) say(`Note: revision ${revision.number} is outdated. Regenerate it so the files show the current data.`);
    }
  } finally {
    await db.$disconnect();
  }

  if (problems.length === 0) {
    say("PASS: zones, totals and both report files match the golden expectations.");
    return 0;
  }
  say(`FAIL: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  for (const problem of problems) say(`  - ${problem}`);
  return 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof GoldenParseError ? error.message : error);
      process.exitCode = 1;
    },
  );
}
