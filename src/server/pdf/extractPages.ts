import path from "node:path";
import { getDocument, InvalidPDFException, PasswordException, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { groupLines } from "@/lib/pdfText";

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

// Standard (non-embedded) font metrics shipped with pdfjs-dist; only used to silence missing-font warnings.
const STANDARD_FONT_DATA_URL = path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + path.sep;

/** Groups text items into lines by baseline and joins each line left to right (shared with the PDF viewer). */
export function buildLines(items: readonly TextItem[]): string[] {
  return groupLines(items).map((line) => line.text);
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
