/**
 * PDF page text as lines, shared by the server (text extraction and evidence checks) and the browser (highlighting
 * the cited line in the PDF viewer). Both sides must build lines the same way, or a quote verified on the server
 * would not be found in the viewer. Pure: no I/O.
 */

/** The parts of a pdf.js TextItem that line building needs. */
export type LineItem = { str: string; transform: number[]; width: number; height: number };

/** One reconstructed line and the indexes of the text items it was built from. */
export type TextLine = { text: string; itemIndexes: number[] };

/** Items whose baselines differ by at most this many points belong to one line. */
const SAME_LINE_TOLERANCE_PT = 2;
/** A horizontal gap wider than this share of the font size separates table columns: rendered as two spaces. */
const COLUMN_GAP_RATIO = 0.6;
/** A smaller gap above this share of the font size is a word space. */
const WORD_GAP_RATIO = 0.15;

type Positioned = { index: number; x: number; y: number; width: number; fontSize: number; text: string };

function toPositioned(item: LineItem, index: number): Positioned {
  const [a, b, , , x, y] = item.transform;
  return { index, x, y, width: item.width, fontSize: Math.hypot(a, b) || item.height || 10, text: item.str };
}

/** Groups text items into lines by baseline and joins each line left to right. */
export function groupLines(items: readonly LineItem[]): TextLine[] {
  // Whitespace-only items are spacers; the gap between the visible items carries the same information.
  const visible = items.flatMap((item, index) => (item.str.trim() === "" ? [] : [toPositioned(item, index)]));
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
      return { text: line.trim(), itemIndexes: sorted.map((item) => item.index) };
    })
    .filter((line) => line.text !== "");
}

/**
 * Text comparison ignores only presentation: Unicode compatibility forms, typographic quotes and dashes, and runs
 * of whitespace (the column gaps). Letters, digits and punctuation must match exactly.
 */
export function normalizeEvidence(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Indexes of the lines that contain the quote after normalization. Verified evidence means exactly one. */
export function findQuoteLines(lines: readonly string[], quote: string): number[] {
  const wanted = normalizeEvidence(quote);
  if (wanted === "") return [];
  return lines.flatMap((line, index) => (normalizeEvidence(line).includes(wanted) ? [index] : []));
}

/** How one text item of a matching line is marked: the whole item, or only part of its text. */
export type ItemHighlight = { whole: true } | { whole: false; start: number; end: number };

export type QuoteHighlights = {
  /** How many lines of the page contain the quote: 1 is verified, 0 not found, more is ambiguous. */
  matchCount: number;
  /** Text item index → how to mark it. */
  items: Map<number, ItemHighlight>;
};

/**
 * Which text items of a page show the quoted evidence. Lines are built exactly as on the server; on each line that
 * contains the quote, an item is marked whole when its text is part of the quote, or partly where the quote starts
 * or ends inside it.
 */
export function quoteHighlights(items: readonly LineItem[], quote: string): QuoteHighlights {
  const lines = groupLines(items);
  const matches = findQuoteLines(
    lines.map((line) => line.text),
    quote,
  );
  const wanted = normalizeEvidence(quote);
  const marked = new Map<number, ItemHighlight>();
  for (const lineIndex of matches) {
    for (const itemIndex of lines[lineIndex].itemIndexes) {
      const highlight = itemHighlight(items[itemIndex].str, wanted);
      if (highlight) marked.set(itemIndex, highlight);
    }
  }
  return { matchCount: matches.length, items: marked };
}

function itemHighlight(raw: string, quote: string): ItemHighlight | null {
  const text = normalizeEvidence(raw);
  if (text === "") return null;
  if (quote.includes(text)) return { whole: true };
  const inside = raw.indexOf(quote);
  if (inside !== -1) return { whole: false, start: inside, end: inside + quote.length };
  const isSpace = (char: string) => /\s/.test(char);
  // The quote starts inside this item: the item's longest suffix that begins the quote (not starting on a space).
  for (let start = 1; start < raw.length; start++) {
    if (isSpace(raw[start])) continue;
    if (quote.startsWith(normalizeEvidence(raw.slice(start)))) return { whole: false, start, end: raw.trimEnd().length };
  }
  // The quote ends inside this item: the item's longest prefix that ends the quote (not ending on a space).
  for (let end = raw.length - 1; end > 0; end--) {
    if (isSpace(raw[end - 1])) continue;
    if (quote.endsWith(normalizeEvidence(raw.slice(0, end)))) return { whole: false, start: 0, end };
  }
  return null;
}
