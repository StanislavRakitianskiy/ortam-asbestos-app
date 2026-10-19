import { formatResultLabel } from "@/domain/format";
import { RESULT_FIELD_LABELS, type EditableResultField } from "@/domain/labReviewInput";
import { RESULT_LABELS, type ResultLabel } from "@/domain/types";
import type { FieldValue, LabResultDto } from "@/server/services/labDocumentDto";

/** Display text of one editable field value. Absent values are shown as a dash, never as 0. */
export function formatFieldValue(field: EditableResultField, value: FieldValue | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "resultLabel" && (RESULT_LABELS as readonly string[]).includes(String(value))) {
    return formatResultLabel(value as ResultLabel);
  }
  if (field === "percentage") return `${value}%`;
  return String(value);
}

/** The content cell: the reviewed number, or the text the lab printed when no number was reported. */
export function formatContent(row: Pick<LabResultDto, "percentage" | "percentageRaw">): string {
  if (row.percentage !== null) return `${row.percentage}%`;
  return row.percentageRaw ?? "—";
}

export type FieldChange = { field: EditableResultField; label: string; from: string; to: string };

/**
 * Each corrected field from its original value to the current one. For an AI row the original is the AI's value
 * (aiJson); for a row added by hand it is the value before the first correction.
 */
export function correctedFields(row: LabResultDto): FieldChange[] {
  const fields = [...new Set(row.corrections.map((correction) => correction.field))];
  return fields.map((field) => {
    const first = row.corrections.find((correction) => correction.field === field);
    const original = row.aiValues && field in row.aiValues ? row.aiValues[field] : first?.oldValue;
    return { field, label: RESULT_FIELD_LABELS[field], from: formatFieldValue(field, original), to: formatFieldValue(field, row[field]) };
  });
}

export const REVIEW_STATUS_LABELS: Record<LabResultDto["reviewStatus"], string> = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

export const REVIEW_STATUS_CLASS: Record<LabResultDto["reviewStatus"], string> = {
  PENDING: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  ACCEPTED: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  REJECTED: "bg-destructive/10 text-destructive",
};
