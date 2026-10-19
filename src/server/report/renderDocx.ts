import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import type { TemplateData } from "@/domain/templateData";

/** The template could not be filled: a tag without a value, or a template docxtemplater cannot read. */
export class TemplateRenderError extends Error {
  readonly code = "TEMPLATE_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "TemplateRenderError";
  }
}

/** A tag whose value is null or undefined is a bug in toTemplateData: fail instead of printing "undefined". */
function nullGetter(part: Docxtemplater.DXT.Part): never {
  const tag = part.module === "loop" ? `{#${part.value}}` : `{${part.value}}`;
  throw new TemplateRenderError(`Report template value missing: ${tag}.`);
}

type DocxError = Error & { properties?: { errors?: unknown[]; explanation?: string; id?: string } };

/** docxtemplater collects template errors into one "Multi error"; this lists each of them. */
function describe(error: unknown): string {
  if (error instanceof TemplateRenderError) return error.message;
  const docxError = error as DocxError;
  const inner = docxError.properties?.errors;
  if (Array.isArray(inner) && inner.length > 0) return inner.map(describe).join(" ");
  if (inner === undefined && docxError.properties?.explanation) return docxError.properties.explanation;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fills the Word template with the report values. paragraphLoop makes a {#list} that stands alone in a paragraph
 * repeat the paragraphs (or the table) between it and {/list}; linebreaks turns "\n" into a line break.
 */
export function renderDocx(template: Uint8Array, data: TemplateData): Uint8Array {
  try {
    const document = new Docxtemplater(new PizZip(template), {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter,
      errorLogging: false,
      stripInvalidXMLChars: true,
    });
    document.render(data);
    return document.toUint8Array({ compression: "DEFLATE" });
  } catch (error) {
    throw new TemplateRenderError(`The report template could not be filled: ${describe(error)}`);
  }
}
