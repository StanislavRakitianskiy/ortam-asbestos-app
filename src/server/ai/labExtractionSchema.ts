import { z } from "zod";
import { RESULT_LABELS } from "@/domain/types";

/**
 * The JSON shape the model must return, sent as the structured output schema.
 * Every field is required; absent values are null, never omitted. No min/max/length constraints here because
 * structured outputs do not enforce them: ranges are checked after the response (src/server/ai/verifyExtraction.ts).
 * This schema must stay free of transforms so it converts to JSON Schema.
 */
export const LabExtractionSchema = z.object({
  report: z.object({
    labReportId: z.string().nullable().describe("Identifier of this lab report as printed, often in the title. null only if none is printed."),
    labName: z.string().nullable().describe("Laboratory name as printed. null if not printed."),
    projectRef: z.string().nullable().describe("Project reference or code as printed. null if not printed."),
    issuedDate: z.string().nullable().describe("Issue date exactly as printed. null if not printed."),
  }),
  results: z
    .array(
      z.object({
        sampleId: z.string().describe("Sample ID exactly as printed."),
        layer: z.string().describe("Layer or material description exactly as printed for this row."),
        resultLabel: z.enum(RESULT_LABELS),
        asbestosType: z.string().nullable().describe('Asbestos type as printed; null when not reported (e.g. "Not reported").'),
        percentage: z.number().nullable().describe('Numeric content in percent, e.g. 15 for "15%"; null when not reported.'),
        percentageRaw: z.string().nullable().describe('Content cell exactly as printed, e.g. "15%" or "Not reported".'),
        sourcePage: z.int().describe("1-based page number the row is printed on."),
        sourceText: z.string().describe("The full table row copied character for character from the page text."),
        labNote: z.string().nullable().describe("Laboratory note about this sample, copied verbatim; null if none."),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    )
    .describe("One entry per printed (sample, layer) row. Never merge layers."),
  documentNotes: z
    .array(
      z.object({
        page: z.int().describe("1-based page number."),
        text: z.string().describe("Note copied verbatim from the page."),
        relatedSampleIds: z.array(z.string()),
      }),
    )
    .describe("Laboratory notes and remarks printed outside the result rows."),
});

export type LabExtraction = z.infer<typeof LabExtractionSchema>;

/** Enum values from the model are compared ignoring case and surrounding spaces. */
const caseInsensitive = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((value) => (typeof value === "string" ? value.trim().toUpperCase() : value), z.enum(values));

/**
 * The same shape, parsed from every response with enum values compared case-insensitively.
 * Confidence comes out as the stored HIGH | MEDIUM | LOW.
 */
export const LenientLabExtractionSchema = z.object({
  report: LabExtractionSchema.shape.report,
  results: z.array(
    z.object({
      ...LabExtractionSchema.shape.results.element.shape,
      resultLabel: caseInsensitive(RESULT_LABELS),
      confidence: caseInsensitive(["HIGH", "MEDIUM", "LOW"] as const),
    }),
  ),
  documentNotes: LabExtractionSchema.shape.documentNotes,
});

export type ParsedLabExtraction = z.infer<typeof LenientLabExtractionSchema>;
export type ParsedLabResult = ParsedLabExtraction["results"][number];

type JsonSchemaNode = { [key: string]: unknown };

const isSafeIntegerBound = (key: string, value: unknown) =>
  (key === "minimum" && value === Number.MIN_SAFE_INTEGER) || (key === "maximum" && value === Number.MAX_SAFE_INTEGER);

function stripSafeIntegerBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSafeIntegerBounds);
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node as JsonSchemaNode)
      .filter(([key, value]) => !isSafeIntegerBound(key, value))
      .map(([key, value]) => [key, stripSafeIntegerBounds(value)]),
  );
}

/**
 * JSON Schema for output_config.format. Built with z.toJSONSchema rather than the SDK's zodOutputFormat helper,
 * which in SDK 0.135 moves `enum` into the description so the result label would not be constrained (D-016).
 * zod adds the safe-integer range to z.int(); structured outputs do not accept numeric bounds, so they are removed.
 */
export function labExtractionJsonSchema(): JsonSchemaNode {
  const schema = z.toJSONSchema(LabExtractionSchema, { target: "draft-2020-12" }) as JsonSchemaNode;
  delete schema.$schema;
  return stripSafeIntegerBounds(schema) as JsonSchemaNode;
}
