import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractPages, hasSelectableText, PdfReadError } from "@/server/pdf/extractPages";

const fixture = async (name: string) => new Uint8Array(await readFile(`fixtures/${name}`));

describe("extractPages", () => {
  it("rebuilds the LAB-A table row of the S02 adhesive layer as one line", async () => {
    const pdf = await extractPages(await fixture("LAB-A_fictional_lab_report.pdf"));

    expect(pdf.pageCount).toBe(1);
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.pages[0].page).toBe(1);
    const rows = pdf.pages[0].lines.filter((line) =>
      ["S02", "Black adhesive", "Detected", "Chrysotile", "2%"].every((part) => line.includes(part)),
    );
    expect(rows).toHaveLength(1);
    // Columns are separated by two spaces, words inside a cell by one.
    expect(rows[0]).toBe("S02  Black adhesive  Detected  Chrysotile  2%");
  });

  it("keeps both S02 layers on separate lines", async () => {
    const { pages } = await extractPages(await fixture("LAB-A_fictional_lab_report.pdf"));
    const s02 = pages[0].lines.filter((line) => line.startsWith("S02  "));
    expect(s02).toEqual(["S02  Floor tile  Not detected  Not reported  Not reported", "S02  Black adhesive  Detected  Chrysotile  2%"]);
  });

  it("reads every page of the other lab reports", async () => {
    for (const name of ["LAB-B_fictional_lab_report.pdf", "LAB-C_fictional_lab_report.pdf"]) {
      const pdf = await extractPages(await fixture(name));
      expect(hasSelectableText(pdf)).toBe(true);
      expect(pdf.pages.map((page) => page.page)).toEqual(Array.from({ length: pdf.pageCount }, (_, index) => index + 1));
    }
  });

  it("returns pages without lines for a PDF that has no selectable text", async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const pdf = await extractPages(await document.save());
    expect(pdf.pageCount).toBe(1);
    expect(pdf.pages[0].lines).toEqual([]);
    expect(hasSelectableText(pdf)).toBe(false);
  });

  it("orders lines top to bottom and words left to right", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([400, 400]);
    page.drawText("second", { x: 50, y: 200, size: 10, font });
    page.drawText("right", { x: 200, y: 300, size: 10, font });
    page.drawText("left", { x: 50, y: 301, size: 10, font });
    const pdf = await extractPages(await document.save());
    expect(pdf.pages[0].lines).toEqual(["left  right", "second"]);
  });

  it("rejects bytes that are not a PDF with a readable message", async () => {
    await expect(extractPages(new TextEncoder().encode("not a pdf"))).rejects.toBeInstanceOf(PdfReadError);
  });
});
