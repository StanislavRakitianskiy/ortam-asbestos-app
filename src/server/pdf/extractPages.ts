import path from "node:path";
import { getDocument, InvalidPDFException, PasswordException, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

/** Text of one PDF page as reconstructed lines, top to bottom. page is 1-based. */
export type PageText = { page: number; lines: string[] };

export type ExtractedPdf = { pageCount: number; pages: PageText[] };

/** The bytes could not be opened as a PDF. The message is meant for the employee. */
export class PdfReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfReadError";
  }
}

/** Items whose baselines differ by at most this many points belong to one line. */
const SAME_LINE_TOLERANCE_PT = 2;
/** A horizontal gap wider than this share of the font size separates table columns: rendered as two spaces. */
const COLUMN_GAP_RATIO = 0.6;
/** A smaller gap above this share of the font size is a word space. */
const WORD_GAP_RATIO = 0.15;

// Standard (non-embedded) font metrics shipped with pdfjs-dist; only used to silence missing-font warnings.
const STANDARD_FONT_DATA_URL = path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + path.sep;

type Positioned = { x: number; y: number; width: number; fontSize: number; text: string };

function toPositioned(item: TextItem): Positioned {
  const [a, b, , , x, y] = item.transform as number[];
  return { x, y, width: item.width, fontSize: Math.hypot(a, b) || item.height || 10, text: item.str };
}

/** Groups text items into lines by baseline and joins each line left to right. */
export function buildLines(items: readonly TextItem[]): string[] {
  // Whitespace-only items are spacers; the gap between the visible items carries the same information.
  const visible = items.filter((item) => item.str.trim() !== "").map(toPositioned);
  const rows: { y: number; items: Positioned[] }[] = [];
  for (const item of visible) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= SAME_LINE_TOLERANCE_PT);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  // PDF y grows upwards, so the top line has the largest y.
  rows.sort((first, second) => second.y - first.y);
  return rows
    .map((row) => {
      const sorted = [...row.items].sort((first, second) => first.x - second.x);
      let line = "";
      let previousEnd: number | null = null;
      for (const item of sorted) {
        if (previousEnd !== null) {
          const gap = item.x - previousEnd;
          if (gap > item.fontSize * COLUMN_GAP_RATIO) line += "  ";
          else if (gap > item.fontSize * WORD_GAP_RATIO && !line.endsWith(" ") && !item.text.startsWith(" ")) line += " ";
        }
        line += item.text;
        previousEnd = item.x + item.width;
      }
      return line.trim();
    })
    .filter((line) => line !== "");
}

const isTextItem = (item: object): item is TextItem => "str" in item;

/** Reads the selectable text of every page. Scanned pages come back with no lines; OCR is out of scope. */
export async function extractPages(bytes: Uint8Array): Promise<ExtractedPdf> {
  // pdfjs may transfer (detach) the buffer it is given, so it gets its own copy.
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    verbosity: VerbosityLevel.ERRORS,
  });
  let document;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy();
    if (error instanceof PasswordException) throw new PdfReadError("The PDF is password-protected and cannot be read.");
    if (error instanceof InvalidPDFException) throw new PdfReadError("The file is damaged or is not a valid PDF.");
    throw new PdfReadError("The PDF could not be opened.");
  }
  try {
    const pages: PageText[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      pages.push({ page, lines: buildLines(content.items.filter(isTextItem)) });
    }
    return { pageCount: document.numPages, pages };
  } finally {
    await loadingTask.destroy();
  }
}

export const hasSelectableText = (pdf: ExtractedPdf) => pdf.pages.some((page) => page.lines.length > 0);
