import { z } from "zod";
import { resultLabelSchema } from "./types";

/**
 * Input schemas for reviewing extracted lab rows. The review dialogs and the API route handlers use the same
 * schemas, and the review service parses with them again, so a missing reason is a 400 however it is called.
 */

const text = (max: number) => z.string().trim().max(max, { error: `must be at most ${max} characters` });

/** Blank text means "not reported" and is stored as null. */
const optionalText = (max: number) =>
  text(max)
    .nullable()
    .transform((value) => (value === "" ? null : value));

/** Characters that would turn one sample ID into several ("S03|S07"). */
const SAMPLE_ID_SEPARATORS = /[\s,;|]/;

/** Kept as printed (trimmed); matching normalizes it with trim + uppercase. */
const sampleIdSchema = text(40)
  .min(1, { error: "is required" })
  .refine((value) => !SAMPLE_ID_SEPARATORS.test(value), {
    error: "must be a single sample ID without spaces, commas or |",
  });

/** Every correction, rejection and added row needs a short reason for the correction log. */
export const reasonSchema = z
  .string({ error: "Enter a short reason." })
  .trim()
  .min(1, { error: "Enter a short reason." })
  .max(300, { error: "must be at most 300 characters" });

/** The values of a lab row the employee may correct. Page and quote are evidence and stay as extracted. */
export const EDITABLE_RESULT_FIELDS = ["sampleId", "layer", "resultLabel", "asbestosType", "percentage", "labNote"] as const;
export type EditableResultField = (typeof EDITABLE_RESULT_FIELDS)[number];

export const RESULT_FIELD_LABELS: Record<EditableResultField, string> = {
  sampleId: "Sample ID",
  layer: "Layer",
  resultLabel: "Result",
  asbestosType: "Asbestos type",
  percentage: "Content %",
  labNote: "Lab note",
};

const resultFields = {
  sampleId: sampleIdSchema,
  layer: text(200).min(1, { error: "is required" }),
  resultLabel: resultLabelSchema,
  /** null when the lab did not report a type. */
  asbestosType: optionalText(100),
  /** null when the lab did not report a content. Never a threshold: the label is what the lab printed. */
  percentage: z
    .number({ error: "must be a number from 0 to 100, or empty when not reported" })
    .min(0, { error: "must be from 0 to 100" })
    .max(100, { error: "must be from 0 to 100" })
    .nullable(),
  labNote: optionalText(1000),
};

export const labResultCorrectionSchema = z.strictObject({
  changes: z
    .strictObject(resultFields)
    .partial()
    .refine((changes) => Object.keys(changes).length > 0, { error: "Change at least one value." }),
  reason: reasonSchema,
  /** Accept the corrected row in the same step. Without it a corrected row goes back to pending. */
  accept: z.boolean().optional(),
});
export type LabResultCorrectionInput = z.input<typeof labResultCorrectionSchema>;
export type LabResultCorrection = z.output<typeof labResultCorrectionSchema>;

export const labResultDecisionSchema = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("ACCEPT") }),
  z.strictObject({ decision: z.literal("REJECT"), reason: reasonSchema }),
  /** Back to pending, e.g. after a mistaken accept or reject. */
  z.strictObject({ decision: z.literal("REOPEN") }),
]);
export type LabResultDecisionInput = z.input<typeof labResultDecisionSchema>;
export type LabResultDecision = z.output<typeof labResultDecisionSchema>;

/** A row the AI missed, typed by the employee with its evidence: the page and the line as printed. */
export const manualLabResultSchema = z.strictObject({
  ...resultFields,
  sourcePage: z.int({ error: "must be a page number" }).positive({ error: "must be a page number" }),
  sourceText: text(1000).min(1, { error: "Copy the supporting line from the PDF." }),
  reason: reasonSchema,
});
export type ManualLabResultInput = z.input<typeof manualLabResultSchema>;
export type ManualLabResult = z.output<typeof manualLabResultSchema>;

/** The lab report ID entered or corrected by the employee, e.g. when the AI could not read it from the header. */
export const labReportIdInputSchema = z.strictObject({
  labReportId: text(60).min(1, { error: "is required" }),
  reason: reasonSchema,
});
export type LabReportIdInput = z.input<typeof labReportIdInputSchema>;
