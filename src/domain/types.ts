import { z } from "zod";

/** Units exactly as supplied in the exercise inputs. */
export const UNITS = ["m2", "linear_m"] as const;
export const unitSchema = z.enum(UNITS);
export type Unit = z.infer<typeof unitSchema>;

export const CONDITIONS = ["intact", "damaged", "poor", "unknown"] as const;
export const conditionSchema = z.enum(CONDITIONS);
export type Condition = z.infer<typeof conditionSchema>;

/** Explicit lab labels. No concentration threshold is ever applied to derive or change them. */
export const RESULT_LABELS = ["DETECTED", "NOT_DETECTED", "INCONCLUSIVE"] as const;
export const resultLabelSchema = z.enum(RESULT_LABELS);
export type ResultLabel = z.infer<typeof resultLabelSchema>;

export const ZONE_STATUSES = [
  "DETECTED",
  "NOT_DETECTED",
  "INCONCLUSIVE",
  "CONFLICT",
  "AWAITING_RESULT",
  "UNSAMPLED",
  "INACCESSIBLE",
] as const;
export type ZoneStatus = (typeof ZONE_STATUSES)[number];

export const CATEGORIES = ["A", "B", "C", "D"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Money is always an integer number of CAD cents. Format only at the edge (see format.ts). */
export type Cents = number;

/** Quantities are limited to two decimals so cost arithmetic stays exact in integer cents. */
export const QUANTITY_MAX_DECIMALS = 2;

const nonBlank = z.string().refine((value) => value.trim() !== "", { error: "must not be blank" });

const hasAtMostDecimals = (value: number, decimals: number) => {
  const scaled = value * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
};

/** A measured quantity, or null when it was not measured. Never replace null with 0. */
export const quantitySchema = z
  .number({ error: "must be a number, or null when the quantity is unknown" })
  .positive({ error: "must be greater than 0; mark it Unknown if it was not measured" })
  .refine((value) => hasAtMostDecimals(value, QUANTITY_MAX_DECIMALS), {
    error: `must have at most ${QUANTITY_MAX_DECIMALS} decimals`,
  })
  .nullable();

export const materialZoneSchema = z.object({
  id: nonBlank,
  materialId: nonBlank,
  description: z.string(),
  floor: z.string(),
  location: z.string(),
  sampleIds: z.array(nonBlank),
  quantity: quantitySchema,
  unit: unitSchema,
  condition: conditionSchema,
  plannedDisturbance: z.boolean(),
  rateRef: nonBlank.nullable(),
  accessible: z.boolean(),
  notes: z.string(),
});
export type MaterialZone = z.infer<typeof materialZoneSchema>;

/** One lab row after employee review, with the evidence it came from. */
export const acceptedLabResultSchema = z.object({
  id: nonBlank,
  documentId: nonBlank,
  labReportId: nonBlank,
  fileName: nonBlank,
  page: z.int().positive(),
  sourceText: nonBlank,
  sampleId: nonBlank,
  layer: nonBlank,
  resultLabel: resultLabelSchema,
  asbestosType: z.string().nullable(),
  percentage: z.number().min(0).max(100).nullable(),
  /** Content exactly as printed by the lab, e.g. "15%" or "Not reported". */
  percentageRaw: z.string().nullable(),
  labNote: z.string().nullable(),
});
export type AcceptedLabResult = z.infer<typeof acceptedLabResultSchema>;
