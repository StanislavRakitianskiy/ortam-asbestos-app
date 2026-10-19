// Builds templates/report_template.docx from the supplied Word master (fixtures/master_asbestos_report.docx).
//
// Every [bracketed placeholder] and the few fixed values of the master that the report fills in (2500.00, 1200.00,
// the master's own instructions) become docxtemplater tags. Each one is looked up by the exact text of its <w:t>; if
// the master does not contain it, the build fails instead of producing a template with a silent gap. Only
// word/document.xml changes: styles, fonts, numbering and theme are copied as they are, and new paragraphs and tables
// reuse the master's own paragraph, heading, table and cell markup.
//
// Run with `npm run template:build`. Executed by Node's built-in TypeScript support, so keep to erasable syntax and
// no relative imports. The output is reproducible: re-running it gives the same document.xml.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";

export const MASTER_PATH = path.join("fixtures", "master_asbestos_report.docx");
export const TEMPLATE_PATH = path.join("templates", "report_template.docx");
const DOCUMENT = "word/document.xml";
const FIXED_DATE = new Date("2026-10-19T00:00:00Z");

export class TemplateBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateBuildError";
  }
}

type Range = { start: number; end: number };

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TEXT_ELEMENT = /<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g;

/** Start positions of the <w:t> elements whose whole text is `text`. */
function textElements(xml: string, text: string): number[] {
  const wanted = escapeXml(text);
  return [...xml.matchAll(TEXT_ELEMENT)].filter((match) => match[1] === wanted).map((match) => match.index);
}

/** The single <w:t> whose text is `text`. A missing or repeated text means the master is not the expected file. */
function single(xml: string, text: string): number {
  const found = textElements(xml, text);
  if (found.length === 0) throw new TemplateBuildError(`Placeholder not found in master: ${text}`);
  if (found.length > 1) throw new TemplateBuildError(`Placeholder found ${found.length} times in master, expected once: ${text}`);
  return found[0];
}

/** The <w:p>, <w:tr>, <w:tc> or <w:tbl> element around position `at`. The master nests none of them in itself. */
function enclosing(xml: string, at: number, tag: "p" | "tr" | "tc" | "tbl"): Range {
  let start = -1;
  for (const match of xml.matchAll(new RegExp(`<w:${tag}[ >]`, "g"))) {
    if (match.index > at) break;
    start = match.index;
  }
  const close = `</w:${tag}>`;
  const end = start < 0 ? -1 : xml.indexOf(close, start);
  if (start < 0 || end < at) throw new TemplateBuildError(`No <w:${tag}> around position ${at} of ${DOCUMENT}.`);
  return { start, end: end + close.length };
}

const slice = (xml: string, range: Range) => xml.slice(range.start, range.end);
const splice = (xml: string, range: Range, replacement: string) => xml.slice(0, range.start) + replacement + xml.slice(range.end);

/** A copy of a paragraph that has exactly one <w:t>, with that text replaced. */
function withText(paragraph: string, text: string): string {
  const count = [...paragraph.matchAll(TEXT_ELEMENT)].length;
  if (count !== 1) throw new TemplateBuildError(`Expected one text run in the paragraph, found ${count}: ${paragraph.slice(0, 120)}`);
  return paragraph.replace(TEXT_ELEMENT, () => `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`);
}

/** A copy of a paragraph in another paragraph style of the master (Heading2, ListBullet …). */
function withStyle(paragraph: string, styleId: string): string {
  if (/<w:pStyle w:val="[^"]*"\/>/.test(paragraph)) return paragraph.replace(/<w:pStyle w:val="[^"]*"\/>/, `<w:pStyle w:val="${styleId}"/>`);
  return paragraph.replace(/^<w:p>/, `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>`);
}

function replaceAt(xml: string, at: number, to: string): string {
  const paragraph = enclosing(xml, at, "p");
  return splice(xml, paragraph, withText(slice(xml, paragraph), to));
}

function replaceText(xml: string, from: string, to: string): string {
  return replaceAt(xml, single(xml, from), to);
}

/** Replaces the texts of a placeholder that occurs several times, in document order. */
function replaceEach(xml: string, from: string, to: readonly string[]): string {
  const found = textElements(xml, from);
  if (found.length !== to.length) {
    throw new TemplateBuildError(`Placeholder found ${found.length} times in master, expected ${to.length}: ${from}`);
  }
  return to.reduce((result, replacement) => replaceAt(result, textElements(result, from)[0], replacement), xml);
}

/**
 * Replaces the paragraph holding `from` with copies of itself, one per entry. With paragraphLoop, a paragraph that
 * holds only {#loop} or {/loop} disappears, so ["{#items}", "{text}", "{/items}"] is one paragraph per item.
 */
function expandParagraph(xml: string, from: string, paragraphs: readonly (string | { text: string; style: string })[]): string {
  const paragraph = enclosing(xml, single(xml, from), "p");
  const sample = slice(xml, paragraph);
  const copies = paragraphs.map((entry) => (typeof entry === "string" ? withText(sample, entry) : withStyle(withText(sample, entry.text), entry.style)));
  return splice(xml, paragraph, copies.join(""));
}

const loop = (name: string, item: string | { text: string; style: string }) => [`{#${name}}`, item, `{/${name}}`];

/** The texts of the cells of a table row. */
function rowTexts(row: string): string[] {
  return [...row.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cell) => [...cell[0].matchAll(TEXT_ELEMENT)].map((match) => match[1]).join(""));
}

// ---------------------------------------------------------------- new markup from the master's own pieces

type Samples = { plain: string; heading: string; pageBreak: string; tblPr: string; cell: string; textWidth: number };

function samples(xml: string): Samples {
  const plain = slice(xml, enclosing(xml, single(xml, "FICTIONAL HIRING EXERCISE ONLY - NOT A REAL LAB RESULT OR PROPERTY ASSESSMENT"), "p"));
  const heading = slice(xml, enclosing(xml, single(xml, "Project information"), "p"));
  const breakAt = xml.indexOf('<w:br w:type="page"/>');
  if (breakAt < 0) throw new TemplateBuildError("No page break paragraph found in master.");
  const pageBreak = slice(xml, enclosing(xml, breakAt, "p"));
  const tblPr = /<w:tblPr>[\s\S]*?<\/w:tblPr>/.exec(xml)?.[0];
  const cell = /<w:tc>[\s\S]*?<\/w:tc>/.exec(xml)?.[0];
  const pageWidth = /<w:pgSz w:w="(\d+)"/.exec(xml)?.[1];
  const margins = /<w:pgMar [^>]*w:right="(\d+)"[^>]*w:left="(\d+)"/.exec(xml);
  if (!tblPr || !cell || !pageWidth || !margins) throw new TemplateBuildError("Master has no table or page setup to copy.");
  if (!heading.includes('w:val="Heading1"')) throw new TemplateBuildError("Master heading paragraph has no Heading1 style.");
  return { plain, heading, pageBreak, tblPr, cell, textWidth: Number(pageWidth) - Number(margins[1]) - Number(margins[2]) };
}

const paragraph = (s: Samples, text: string) => withText(s.plain, text);
const heading2 = (s: Samples, text: string) => withText(s.heading, text).replace('w:val="Heading1"', 'w:val="Heading2"');

/** Appendix tables have six columns, so their text is 9 pt instead of the master's 10 pt (w:sz is in half points). */
const APPENDIX_FONT_SIZE = 18;

function cell(s: Samples, width: number, text: string): string {
  const sized = s.cell
    .replace(/<w:tcW w:type="dxa" w:w="\d+"\/>/, `<w:tcW w:type="dxa" w:w="${width}"/>`)
    .replace(/<w:sz w:val="\d+"\/>/, `<w:sz w:val="${APPENDIX_FONT_SIZE}"/>`);
  return withText(sized, text);
}

type Column = { header: string; width: number; tag: string };

/** A table in the master's style: a header row repeated on every page and one row repeated for each item of `rows`. */
function loopTable(s: Samples, rows: string, columns: readonly Column[]): string {
  const total = columns.reduce((sum, column) => sum + column.width, 0);
  if (total !== s.textWidth) throw new TemplateBuildError(`Columns of ${rows} are ${total} twips wide, the text width is ${s.textWidth}.`);
  const grid = columns.map((column) => `<w:gridCol w:w="${column.width}"/>`).join("");
  const header = columns.map((column) => cell(s, column.width, column.header)).join("");
  const body = columns
    .map((column, index) => {
      const open = index === 0 ? `{#${rows}}` : "";
      const close = index === columns.length - 1 ? `{/${rows}}` : "";
      return cell(s, column.width, `${open}{${column.tag}}${close}`);
    })
    .join("");
  return `<w:tbl>${s.tblPr}<w:tblGrid>${grid}</w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${header}</w:tr><w:tr>${body}</w:tr></w:tbl>`;
}

/** An appendix: heading, the table when `flag` is true, otherwise one sentence. */
function appendix(s: Samples, title: string, flag: string, table: string, emptyText: string): string {
  return [
    heading2(s, title),
    paragraph(s, `{#${flag}}`),
    table,
    paragraph(s, `{/${flag}}`),
    paragraph(s, `{^${flag}}`),
    paragraph(s, emptyText),
    paragraph(s, `{/${flag}}`),
  ].join("");
}

function appendices(s: Samples): string {
  return [
    s.pageBreak,
    heading2(s, "Appendix A — Lab source references"),
    paragraph(s, "{#labDocumentLines}"),
    paragraph(s, "{text}"),
    paragraph(s, "{/labDocumentLines}"),
    paragraph(s, `{#hasLabSources}`),
    loopTable(s, "labSourceRows", [
      { header: "Report", width: 950, tag: "srcReport" },
      { header: "File", width: 1950, tag: "srcFile" },
      { header: "Page", width: 700, tag: "srcPage" },
      { header: "Sample", width: 900, tag: "srcSample" },
      { header: "Layer", width: 1300, tag: "srcLayer" },
      { header: "Quoted source text", width: 2840, tag: "srcQuote" },
    ]),
    paragraph(s, `{/hasLabSources}`),
    paragraph(s, `{^hasLabSources}`),
    paragraph(s, "No accepted lab result rows are used in this draft."),
    paragraph(s, `{/hasLabSources}`),
    appendix(
      s,
      "Appendix B — Sample register",
      "hasSampleRows",
      loopTable(s, "sampleRows", [
        { header: "Sample", width: 900, tag: "smpSample" },
        { header: "Material zone", width: 1240, tag: "smpZone" },
        { header: "Location", width: 2200, tag: "smpLocation" },
        { header: "Status", width: 2000, tag: "smpStatus" },
        { header: "Layer results", width: 1000, tag: "smpLayers" },
        { header: "Lab reports", width: 1300, tag: "smpReports" },
      ]),
      "No samples are registered and no lab sample was received.",
    ),
    appendix(
      s,
      "Appendix C — Employee corrections",
      "hasCorrectionRows",
      loopTable(s, "correctionRows", [
        { header: "Date (UTC)", width: 1300, tag: "corDate" },
        { header: "Lab data", width: 2000, tag: "corTarget" },
        { header: "Field", width: 1100, tag: "corField" },
        { header: "From", width: 1200, tag: "corFrom" },
        { header: "To", width: 1200, tag: "corTo" },
        { header: "Reason", width: 1840, tag: "corReason" },
      ]),
      "No employee corrections were recorded.",
    ),
    appendix(
      s,
      "Appendix D — Review items and resolutions",
      "hasDecisionRows",
      loopTable(s, "decisionRows", [
        { header: "Review item", width: 2900, tag: "decIssue" },
        { header: "Decision", width: 1100, tag: "decDecision" },
        { header: "Employee note", width: 2300, tag: "decNote" },
        { header: "Decided (UTC)", width: 1300, tag: "decDate" },
        { header: "Status", width: 1040, tag: "decState" },
      ]),
      "No review item needed a decision.",
    ),
    paragraph(s, "{#hasPlans}"),
    heading2(s, "Appendix E — Floor plan"),
    paragraph(s, "{planNote}"),
    paragraph(s, "{/hasPlans}"),
    // The body ends with a paragraph, as Word itself writes it.
    paragraph(s, ""),
  ].join("");
}

// ---------------------------------------------------------------- the master, section by section

/** Turns the master's document.xml into the template's. Throws TemplateBuildError when the master is not as expected. */
export function buildDocumentXml(master: string): string {
  const s = samples(master);
  let xml = master;

  // Title block.
  xml = replaceText(xml, "Asbestos assessment report model", "Asbestos assessment report");
  xml = replaceText(
    xml,
    "ORTAM developer exercise | Editable master model | Version 1",
    "Report {projectCode} | Revision {revisionNumber} | Generated {generatedAt} | Snapshot {snapshotShort}",
  );
  xml = replaceText(
    xml,
    "Use this structure for the employee-reviewed report generated by the application. Replace bracketed fields with supported project information. Keep unresolved findings and unpriced work visible. This document is a model, not a completed property assessment.",
    "{reportStatusNote}",
  );

  // Project information. The Status row keeps the master's wording (REPORT_STATUS, checked by a test).
  xml = replaceText(xml, "[Project ID] [Client]", "{infoProjectClient}");
  xml = replaceText(xml, "[Building] [Address]", "{infoBuildingAddress}");
  xml = replaceText(xml, "[Inspection date] [Report date]", "{infoDates}");
  xml = replaceText(xml, "[Prepared by] [Reviewed by or pending]", "{infoPeople}");
  xml = replaceText(xml, "[Accessible areas] [Planned disturbance]", "{infoScope}");
  single(xml, "Draft pending human and professional review");

  // Executive summary: the narrative paragraphs, then the facts paragraph built in code.
  xml = expandParagraph(
    xml,
    "[Summarize confirmed material zones, affected locations, unresolved findings and major limitations. Distinguish sample count from material zone count. Identify review actions without claiming legal compliance or clearance.]",
    loop("summaryParagraphs", "{text}"),
  );
  xml = replaceText(
    xml,
    "[State the illustrative priced subtotal and contingency-inclusive total in CAD. List confirmed but unpriced materials and unresolved areas separately. Explain that fictional exercise prices are not quotations.]",
    "{summaryFacts}",
  );

  // Findings: one heading and record table per material zone, one paragraph per layer in the lab cells.
  xml = replaceText(
    xml,
    "Repeat this record for every material zone. Preserve individual layer results and all sample IDs; do not replace a layered result with one unexplained positive or negative label.",
    "{findingsIntro}",
  );
  xml = replaceText(xml, "[Material ID] [Floor] [Room] [Description]", "{zoneLocation}");
  xml = expandParagraph(xml, "[Condition] [Quantity and unit] [Planned work]", loop("fieldLines", "{text}"));
  xml = expandParagraph(xml, "[Report ID] [Source location] [Sample ID] [Layer]", loop("layers", "{layerEvidence}"));
  xml = expandParagraph(xml, "[Result label] [Type if reported] [Percentage if reported]", loop("layers", "{layerResult}"));
  xml = expandParagraph(xml, "[Detected / not detected / inconclusive / unsampled]", loop("interpretationLines", "{text}"));
  xml = expandParagraph(xml, "[Exercise category A B C or D] [Reason]", loop("actionLines", "{text}"));
  xml = expandParagraph(xml, "[Missing information] [Required follow up]", loop("uncertaintyLines", "{text}"));
  const findingsTable = enclosing(xml, single(xml, "{zoneLocation}"), "tbl");
  xml = splice(
    xml,
    findingsTable,
    paragraph(s, "{#zones}") + heading2(s, "Material zone {materialId} — {zoneDescription}") + slice(xml, findingsTable) + paragraph(s, "{/zones}"),
  );

  // Recommendations and scope limitations.
  xml = expandParagraph(
    xml,
    "[Explain why each action follows from a lab result and field observation. Confirmed detected material may require management review; the costing scenario does not itself prescribe removal. Unresolved samples require follow up. Keep professional assessment separate from automated drafting.]",
    loop("recommendations", "{text}"),
  );
  xml = expandParagraph(
    xml,
    "[Record inaccessible areas, missing quantities, inconclusive samples and hidden materials. A negative sample does not establish that an entire room or building is free of asbestos. No air exposure measurement or clearance evidence is supplied.]",
    loop("limitations", { text: "{text}", style: "ListBullet" }),
  );

  // Cost table: the first sample row repeats for every cost line; the second sample row ("[Unmeasured ID] Unknown Not
  // priced …") is covered by the same loop, whose not-priced lines say Unknown / Not priced, so it is removed.
  const unmeasuredRow = enclosing(xml, single(xml, "[Unmeasured ID]"), "tr");
  const unmeasuredCells = rowTexts(slice(xml, unmeasuredRow));
  if (unmeasuredCells.join("|") !== "[Unmeasured ID]|Unknown|Not priced|Not priced|Not priced") {
    throw new TemplateBuildError(`Unexpected unmeasured cost row in master: ${unmeasuredCells.join(" | ")}`);
  }
  xml = splice(xml, unmeasuredRow, "");
  xml = replaceText(xml, "[ID]", "{#costLines}{costZone}");
  xml = replaceText(xml, "[Value + unit]", "{costQuantity}");
  xml = replaceEach(xml, "[CAD rate]", ["{costRemoval}", "{costReplacement}"]);
  xml = replaceText(xml, "[CAD]", "{costTotal}{/costLines}");

  // Summary: removal and replacement subtotals added above the zone subtotal, in the same row markup.
  const zoneSubtotalRow = enclosing(xml, single(xml, "Measured zone subtotal"), "tr");
  const subtotalRow = (label: string, tag: string) =>
    slice(xml, zoneSubtotalRow).replace(">Measured zone subtotal<", `>${label}<`).replace(">[Sum of quantity times both rates]<", `>${tag}<`);
  xml = splice(
    xml,
    zoneSubtotalRow,
    subtotalRow("Removal subtotal", "{removalSubtotal}") + subtotalRow("Replacement subtotal", "{replacementSubtotal}") + slice(xml, zoneSubtotalRow),
  );
  xml = replaceText(xml, "[Sum of quantity times both rates]", "{zoneSubtotal}");
  xml = replaceText(xml, "2500.00", "{mobilization}");
  xml = replaceText(xml, "1200.00", "{assessment}");
  xml = replaceText(xml, "[Zone subtotal plus allowances]", "{direct}");
  xml = replaceText(xml, "Contingency at 20 percent", "Contingency at {contingencyPercent} percent");
  xml = replaceText(xml, "[Direct subtotal times 0.20]", "{contingency}");
  xml = replaceText(xml, "[Direct subtotal plus contingency]", "{total}");

  // Assumptions and exclusions: two bullet lists.
  xml = expandParagraph(
    xml,
    "[List missing quantities and unresolved zones. Exclude taxes, hidden materials, business interruption, engineering design and permits. Do not replace unknown costs with zero. Do not charge multiple times for a zone with several samples.]",
    [
      "How the cost scenario is built:",
      ...loop("assumptionLines", { text: "{text}", style: "ListBullet" }),
      "Not included in the illustrative cost scenario:",
      ...loop("exclusionLines", { text: "{text}", style: "ListBullet" }),
    ],
  );

  // Employee review, the final review line from the checklist, then the appendices.
  xml = expandParagraph(
    xml,
    "[Record employee corrections and review status. Attach lab source references and the sample register. If mapping is implemented, attach a floor plan with labeled markers, a legend and unresolved statuses. No plan does not reduce the core assessment score.]",
    loop("reviewLines", "{text}"),
  );
  const finalReviewText =
    "Final review: [Sample matching checked] [Layers checked] [Quantities checked] [Costs checked] [Narrative checked] [Reviewer and date]. Real use requires qualified professional validation and jurisdiction-specific requirements.";
  const finalReview = enclosing(xml, single(xml, finalReviewText), "p");
  const finalReviewParagraph = withText(
    slice(xml, finalReview),
    "Final review: {checkSamples}; {checkLayers}; {checkQuantities}; {checkCosts}; {checkNarrative}; {reviewerAndDate}. Real use requires qualified professional validation and jurisdiction-specific requirements.",
  );
  xml = splice(xml, finalReview, finalReviewParagraph + appendices(s));

  const leftover = [...xml.matchAll(TEXT_ELEMENT)].map((match) => match[1]).find((text) => /\[[^\]]+\]/.test(text));
  if (leftover !== undefined) throw new TemplateBuildError(`Placeholder left in the template: ${leftover}`);
  return xml;
}

/** The template .docx: the master with only word/document.xml replaced. */
export function buildTemplate(master: Uint8Array): Uint8Array {
  const zip = new PizZip(master);
  const document = zip.file(DOCUMENT);
  if (document === null) throw new TemplateBuildError(`${DOCUMENT} is missing from the master.`);
  zip.file(DOCUMENT, buildDocumentXml(document.asText()), { date: FIXED_DATE });
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

async function main(): Promise<void> {
  const template = buildTemplate(await readFile(MASTER_PATH));
  await mkdir(path.dirname(TEMPLATE_PATH), { recursive: true });
  await writeFile(TEMPLATE_PATH, template);
  console.log(`Wrote ${TEMPLATE_PATH} from ${MASTER_PATH}`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof TemplateBuildError ? error.message : error);
    process.exitCode = 1;
  });
}
