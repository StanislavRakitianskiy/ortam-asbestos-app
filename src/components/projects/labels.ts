import type { Condition, Unit } from "@/domain/types";

/** Display labels only; stored values stay exactly m2 / linear_m and the lower-case conditions. */
export const UNIT_LABELS: Record<Unit, string> = { m2: "m2", linear_m: "linear m" };

export const CONDITION_LABELS: Record<Condition, string> = {
  intact: "Intact",
  damaged: "Damaged",
  poor: "Poor",
  unknown: "Unknown",
};
