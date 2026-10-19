import PizZip from "pizzip";

/** The text of a .docx body, one line per paragraph (table cells are paragraphs too). */
export function docxText(docx: Uint8Array): string {
  const xml = new PizZip(docx).file("word/document.xml")?.asText();
  if (xml === undefined) throw new Error("No word/document.xml in the file.");
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((paragraph) =>
      [...paragraph[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:br\/>/g)].map((match) => (match[0] === "<w:br/>" ? "\n" : match[1])).join(""),
    )
    .join("\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
