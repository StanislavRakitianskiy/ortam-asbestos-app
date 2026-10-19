import { readFile } from "node:fs/promises";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { findQuoteLines, groupLines, quoteHighlights, type LineItem } from "@/lib/pdfText";

/** The text items of LAB-A page 1, exactly as the browser viewer receives them from pdf.js. */
let labA: LineItem[];

beforeAll(async () => {
  const task = getDocument({
    data: new Uint8Array(await readFile("fixtures/LAB-A_fictional_lab_report.pdf")),
    disableFontFace: true,
    verbosity: VerbosityLevel.ERRORS,
  });
  const document = await task.promise;
  const content = await (await document.getPage(1)).getTextContent();
  labA = content.items.map((item) => ("str" in item ? item : { str: "", transform: [0, 0, 0, 0, 0, 0], width: 0, height: 0 }));
  await task.destroy();
});

const item = (str: string, x: number, y: number, width = str.length * 5): LineItem => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width,
  height: 10,
});

const markedText = (items: readonly LineItem[], quote: string) => {
  const { items: marked } = quoteHighlights(items, quote);
  return [...marked.keys()].sort((first, second) => first - second).map((index) => items[index].str.trim());
};

describe("groupLines", () => {
  it("keeps the index of every item it used, skipping whitespace-only spacers", () => {
    const lines = groupLines([item("left", 50, 301), item(" ", 80, 301), item("right", 200, 300), item("second", 50, 200)]);
    expect(lines).toEqual([
      { text: "left  right", itemIndexes: [0, 2] },
      { text: "second", itemIndexes: [3] },
    ]);
  });
});

describe("findQuoteLines", () => {
  it("compares after normalizing whitespace and typographic characters only", () => {
    const lines = ["S01  Insulation  Detected", "S02  Floor tile  Not detected"];
    expect(findQuoteLines(lines, "S01 Insulation   Detected")).toEqual([0]);
    expect(findQuoteLines(lines, "s01 insulation")).toEqual([]);
    expect(findQuoteLines(lines, "  ")).toEqual([]);
    expect(findQuoteLines(lines, "S0")).toEqual([0, 1]);
  });
});

describe("quoteHighlights on the LAB-A page", () => {
  it("marks every cell of the cited S02 adhesive row and nothing of the tile row", () => {
    const quote = "S02  Black adhesive  Detected  Chrysotile  2%";
    expect(quoteHighlights(labA, quote).matchCount).toBe(1);
    expect(markedText(labA, quote).join(" ")).toBe("S02 Black adhesive Detected Chrysotile 2%");
  });

  it("marks only the quoted cells when the quote is part of a row", () => {
    expect(markedText(labA, "Black adhesive  Detected")).toEqual(["Black adhesive", "Detected"]);
  });

  it("finds nothing for a quote that is not printed, and reports a quote on several lines as ambiguous", () => {
    expect(quoteHighlights(labA, "S01  Insulation  Not detected")).toMatchObject({ matchCount: 0 });
    expect(quoteHighlights(labA, "S01  Insulation  Not detected").items.size).toBe(0);
    expect(quoteHighlights(labA, "Chrysotile").matchCount).toBeGreaterThan(1);
  });

  it("marks part of an item where the quote starts or ends inside it", () => {
    const items = [item("S02 Black", 0, 100, 45), item("adhesive Detected", 60, 100, 85)];
    expect(quoteHighlights(items, "Black adhesive").items).toEqual(
      new Map([
        [0, { whole: false, start: 4, end: 9 }],
        [1, { whole: false, start: 0, end: 8 }],
      ]),
    );
  });
});
