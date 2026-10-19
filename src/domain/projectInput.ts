import { z } from "zod";
import { RATE_CARD } from "./rates";
import { normalizeSampleId } from "./sampleId";
import { conditionSchema, quantitySchema, unitSchema } from "./types";

/**
 * Input schemas for the project and material zone forms. The browser uses them for inline checks and the API
 * route handlers use the same schemas, so both reject the same values with the same messages.
 */

const text = (max: number) => z.string().trim().max(max, { error: `must be at most ${max} characters` });
const required = (max: number) => text(max).min(1, { error: "is required" });

/** A calendar day such as "2026-10-01", stored as text so no time zone can shift it. */
const isoDate = z.iso.date({ error: "must be a date in the form YYYY-MM-DD" });

const projectFields = {
  code: required(40),
  client: required(200),
  building: required(200),
  address: text(300),
  inspectionDate: isoDate.nullable(),
  reportDate: isoDate.nullable(),
  preparedBy: text(120),
  /** Blank means the review is still pending and is stored as null. */
  reviewedBy: text(120)
    .nullable()
    .transform((value) => (value === "" ? null : value)),
  scope: text(4000),
  plannedWork: text(4000),
  limitations: text(4000),
  jurisdictionNote: text(1000),
};

const projectObject = z.strictObject(projectFields);

/** Code, client and building are needed to create a project; everything else can be filled in later. */
export const projectCreateSchema = projectObject.partial().required({ code: true, client: true, building: true });
export type ProjectCreateInput = z.input<typeof projectCreateSchema>;
export type ProjectCreate = z.output<typeof projectCreateSchema>;

export const projectUpdateSchema = projectObject
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { error: "Send at least one field to update." });
export type ProjectUpdateInput = z.input<typeof projectUpdateSchema>;
export type ProjectUpdate = z.output<typeof projectUpdateSchema>;

export const RATE_REFS = Object.keys(RATE_CARD);

const rateRefSchema = z
  .string()
  .trim()
  .refine((ref) => Object.hasOwn(RATE_CARD, ref), {
    error: `must be one of ${RATE_REFS.join(", ")}, or null when not assigned`,
  })
  .nullable();

/** Characters that separate IDs in the field notes ("S03|S07") and in the chips input. */
const SAMPLE_ID_SEPARATORS = /[\s,;|]/;

const sampleIdSchema = text(40)
  .min(1, { error: "must not be blank" })
  .refine((value) => !SAMPLE_ID_SEPARATORS.test(value), {
    error: "must be a single sample ID without spaces, commas or |",
  })
  .transform(normalizeSampleId);

/** Normalized (trim + uppercase) sample IDs, each at most once per zone, in the order entered. */
const sampleIdsSchema = z
  .array(sampleIdSchema)
  .max(50, { error: "at most 50 sample IDs per zone" })
  .superRefine((ids, ctx) => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) ctx.addIssue({ code: "custom", message: `${id} is listed twice`, path: [index] });
      seen.add(id);
    });
  });

const zoneFields = {
  /** Uppercased like sample IDs, so "m01" and "M01" cannot both exist in one project. */
  materialId: required(20).transform((value) => value.toUpperCase()),
  description: required(200),
  floor: required(100),
  location: required(200),
  /** Empty for an unsampled or inaccessible zone. */
  sampleIds: sampleIdsSchema,
  /** Required on create: a number, or null for Unknown. A missing value is never read as 0. */
  quantity: quantitySchema,
  unit: unitSchema,
  condition: conditionSchema,
  plannedDisturbance: z.boolean({ error: "must be true or false" }),
  rateRef: rateRefSchema,
  accessible: z.boolean({ error: "must be true or false" }),
  notes: text(2000),
};

export const zoneCreateSchema = z.strictObject({
  ...zoneFields,
  rateRef: zoneFields.rateRef.default(null),
  accessible: zoneFields.accessible.default(true),
  notes: zoneFields.notes.default(""),
});
export type ZoneCreateInput = z.input<typeof zoneCreateSchema>;
export type ZoneCreate = z.output<typeof zoneCreateSchema>;

export const zoneUpdateSchema = z
  .strictObject(zoneFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { error: "Send at least one field to update." });
export type ZoneUpdateInput = z.input<typeof zoneUpdateSchema>;
export type ZoneUpdate = z.output<typeof zoneUpdateSchema>;

/** Splits pasted text such as "S03|S07" or "S03, S07" into normalized IDs. */
export function splitSampleIds(raw: string): string[] {
  return raw
    .split(/[\s,;|]+/)
    .map(normalizeSampleId)
    .filter((id) => id !== "");
}
