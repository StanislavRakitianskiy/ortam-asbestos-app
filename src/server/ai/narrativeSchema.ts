import { z } from "zod";
import type { NarrativeDraft } from "@/domain/narrative";
import { CATEGORIES } from "@/domain/types";
import type { ParseResult } from "@/server/ai/structuredCall";

/**
 * The JSON shape the narrative prompt must return, sent as the structured output schema. Every field is required.
 * No length constraints here: structured outputs do not enforce them. Which zones appear and their categories are
 * checked after the response (checkDraftStructure in src/domain/textGuards.ts).
 */
export const NarrativeDraftSchema = z.object({
  executiveSummary: z
    .array(z.string())
    .describe("One or two paragraphs. No money, amounts or totals: the application adds the cost paragraph."),
  perZone: z
    .array(
      z.object({
        materialId: z.string().describe("Material ID exactly as given in the facts."),
        interpretation: z.string().describe("What the lab reported for every sample and layer, and what it means for the zone."),
        reason: z.string().describe("Why the zone has its given category."),
        uncertainty: z.string().describe("Missing or limited information for this zone."),
        followUp: z.string().describe("The follow-up the category calls for."),
      }),
    )
    .describe("Exactly one entry per material zone in the facts."),
  recommendations: z
    .array(
      z.object({
        materialId: z.string().describe("Material ID exactly as given in the facts."),
        category: z.enum(CATEGORIES).describe("The category exactly as given in the facts."),
        text: z.string().describe("Draft recommendation for professional review."),
      }),
    )
    .describe("Exactly one entry per material zone in the facts."),
  limitations: z.array(z.string()).describe("Short sentences on inspection limitations; may be empty."),
});

// The schema and the domain type must describe the same draft.
const sameShape: z.ZodType<NarrativeDraft> = NarrativeDraftSchema;
void sameShape;

/** Categories from the model are compared ignoring case and surrounding spaces. */
const LenientNarrativeDraftSchema = NarrativeDraftSchema.extend({
  recommendations: z.array(
    NarrativeDraftSchema.shape.recommendations.element.extend({
      category: z.preprocess((value) => (typeof value === "string" ? value.trim().toUpperCase() : value), z.enum(CATEGORIES)),
    }),
  ),
});

const MAX_REPORTED_ISSUES = 10;

export function parseNarrativeDraft(json: unknown): ParseResult<NarrativeDraft> {
  const result = LenientNarrativeDraftSchema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  const extra = issues.length - MAX_REPORTED_ISSUES;
  return { ok: false, issues: extra > 0 ? [...issues.slice(0, MAX_REPORTED_ISSUES), `and ${extra} more problem(s)`] : issues };
}

type JsonSchemaNode = { [key: string]: unknown };

/** JSON Schema for output_config.format, built like labExtractionJsonSchema (D-016). */
export function narrativeJsonSchema(): JsonSchemaNode {
  const schema = z.toJSONSchema(NarrativeDraftSchema, { target: "draft-2020-12" }) as JsonSchemaNode;
  delete schema.$schema;
  return schema;
}
