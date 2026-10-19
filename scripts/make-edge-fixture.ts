// TEST FIXTURE GENERATOR. Writes fixtures/test/LAB-X_edge_cases.pdf: a fictional lab report made by the candidate,
// in the same one-table layout as the supplied LAB-A/B/C PDFs, to demonstrate the review step on two edge cases:
//   - "S7"  : a sample ID the material register does not contain (the register has S07). Never matched automatically.
//   - "S04" : detected here, while LAB-B reports the same sample layer as not detected: a conflicting result.
// It is used only in the separate demo project ORTAM-DEMO-001-EDGE and in tests, never in ORTAM-DEMO-001.
//
// Run with `npm run fixture:edge`. Executed by Node's built-in TypeScript support, so keep to erasable syntax.
// The output is byte-for-byte reproducible (fixed dates and metadata), so re-running it does not change its SHA-256.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const OUTPUT = path.join("fixtures", "test", "LAB-X_edge_cases.pdf");
const FIXED_DATE = new Date("2026-10-19T00:00:00Z");

const PAGE = { width: 612, height: 792 };
const MARGIN = 48;
const TABLE = {
  /** Left edges of the Sample, Layer, Result, Type and Content columns, then the right edge of the table. */
  columns: [48, 98, 241, 341, 441, 577],
  rowHeight: 28,
  inset: 8,
};

const HEADER = ["Sample", "Layer", "Result", "Type", "Content"];
const ROWS = [
  ["S7", "Textured coating", "Detected", "Chrysotile", "1%"],
  ["S04", "Plaster", "Detected", "Chrysotile", "3%"],
];

const GREY_TEXT = rgb(0.45, 0.45, 0.45);
const RED = rgb(0.75, 0.1, 0.1);
const GRID = rgb(0.72, 0.74, 0.82);
const HEADER_FILL = rgb(0.93, 0.94, 0.97);

function text(page: PDFPage, value: string, x: number, y: number, font: PDFFont, size: number, color = rgb(0, 0, 0)) {
  page.drawText(value, { x, y, font, size, color });
}

/** Largest size up to `max` at which the text fits the width. */
function fittingSize(font: PDFFont, value: string, width: number, max: number): number {
  return Math.min(max, (max * width) / font.widthOfTextAtSize(value, max));
}

async function main(): Promise<void> {
  const document = await PDFDocument.create();
  document.setTitle("TEST FIXTURE - Fictional asbestos laboratory report LAB-X (edge cases)");
  document.setAuthor("Candidate test fixture - not an ORTAM file");
  document.setSubject("Edge cases for the review step: unmatched sample ID S7, conflicting S04 result");
  document.setCreator("scripts/make-edge-fixture.ts");
  document.setProducer("pdf-lib");
  document.setCreationDate(FIXED_DATE);
  document.setModificationDate(FIXED_DATE);

  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([PAGE.width, PAGE.height]);
  const contentWidth = PAGE.width - 2 * MARGIN;

  const title = "Fictional asbestos laboratory report LAB-X";
  const titleSize = 20;
  text(page, title, (PAGE.width - bold.widthOfTextAtSize(title, titleSize)) / 2, 724, bold, titleSize);

  const caption = "TEST FIXTURE created by the candidate — not an ORTAM file";
  const captionSize = fittingSize(bold, caption, contentWidth - 32, 18);
  page.drawRectangle({ x: MARGIN - 4, y: 680, width: contentWidth + 8, height: 30, borderColor: RED, borderWidth: 1.5 });
  text(page, caption, (PAGE.width - bold.widthOfTextAtSize(caption, captionSize)) / 2, 690, bold, captionSize, RED);

  const intro = [
    "FICTIONAL TEST DATA ONLY - NOT FOR PROPERTY OR SAFETY DECISIONS",
    "Project ORTAM-DEMO-001-EDGE | Fictional Training Building A",
    "Demo Materials Lab - fictional; no accreditation claimed. Received October 2 2026. Issued October 6 2026.",
    "Synthetic record for testing the review step. No sample was actually tested.",
  ];
  intro.forEach((line, index) => text(page, line, MARGIN, 650 - index * 22, regular, 10));

  // The table: a shaded header row, then one row per sample layer, with a grid like the supplied reports.
  const top = 560;
  const [left, , , , , right] = TABLE.columns;
  const rows = [HEADER, ...ROWS];
  const bottom = top - rows.length * TABLE.rowHeight;
  page.drawRectangle({ x: left, y: top - TABLE.rowHeight, width: right - left, height: TABLE.rowHeight, color: HEADER_FILL });
  rows.forEach((cells, rowIndex) => {
    const baseline = top - rowIndex * TABLE.rowHeight - TABLE.rowHeight / 2 - 3.5;
    cells.forEach((cell, column) => text(page, cell, TABLE.columns[column] + TABLE.inset, baseline, regular, 10));
  });
  for (let line = 0; line <= rows.length; line++) {
    const y = top - line * TABLE.rowHeight;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.6, color: GRID });
  }
  for (const x of TABLE.columns) {
    page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.6, color: GRID });
  }

  const closing = [
    "Results apply only to the listed fictional samples and layers. They do not establish site condition, airborne",
    "exposure, remediation scope, regulatory compliance or clearance.",
  ];
  closing.forEach((line, index) => text(page, line, MARGIN, bottom - 36 - index * 14, regular, 10));

  text(page, "TEST FIXTURE created by the candidate — not an ORTAM file", MARGIN, 36, regular, 8, GREY_TEXT);
  text(page, "1", PAGE.width - MARGIN - 4, 36, regular, 8, GREY_TEXT);

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, await document.save());
  console.log(`Wrote ${OUTPUT}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
