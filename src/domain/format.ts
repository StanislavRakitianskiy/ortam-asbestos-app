import type { Cents, ResultLabel, Unit } from "./types";

const groupedInteger = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
const quantityNumber = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

/** 3280800 → "32,808.00". Integer arithmetic only, so no floating-point drift. */
export function formatCad(cents: Cents): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Money must be an integer number of cents, got ${cents}.`);
  }
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${groupedInteger.format(Math.floor(absolute / 100))}.${String(absolute % 100).padStart(2, "0")}`;
}

/** 140, "m2" → "140 m2"; null → "Unknown". An unknown quantity is never shown as 0. */
export function formatQuantity(quantity: number | null, unit: Unit): string {
  return quantity === null ? "Unknown" : `${quantityNumber.format(quantity)} ${unit}`;
}

const RESULT_LABEL_TEXT: Record<ResultLabel, string> = {
  DETECTED: "Detected",
  NOT_DETECTED: "Not detected",
  INCONCLUSIVE: "Inconclusive",
};

export function formatResultLabel(label: ResultLabel): string {
  return RESULT_LABEL_TEXT[label];
}
