import type { Cents, Unit } from "./types";

export interface Rate {
  ref: string;
  material: string;
  unit: Unit;
  /** Cents per unit. */
  removalRate: Cents;
  /** Cents per unit. */
  replacementRate: Cents;
}

export type RateCard = Readonly<Record<string, Rate>>;

/** Fictional rate card from fixtures/fictional_rates_and_rules.pdf. */
export const RATE_CARD: RateCard = Object.freeze({
  R_PIPE: { ref: "R_PIPE", material: "Pipe insulation", unit: "linear_m", removalRate: 12_000, replacementRate: 4_000 },
  R_FLOOR: {
    ref: "R_FLOOR",
    material: "Floor assembly including adhesive",
    unit: "m2",
    removalRate: 4_500,
    replacementRate: 3_500,
  },
  R_CEILING: { ref: "R_CEILING", material: "Ceiling finish", unit: "m2", removalRate: 6_000, replacementRate: 3_000 },
  R_PANEL: { ref: "R_PANEL", material: "Exterior panel", unit: "m2", removalRate: 8_500, replacementRate: 6_500 },
});

/** Added once per project when at least one zone is priced. */
export const MOBILIZATION: Cents = 250_000;
/** Added once per project when at least one zone is priced. */
export const PROFESSIONAL_ASSESSMENT: Cents = 120_000;

/** Contingency on the direct subtotal. The integer percent keeps the arithmetic exact. */
export const CONTINGENCY_PERCENT = 20;
export const CONTINGENCY = CONTINGENCY_PERCENT / 100;

/** "Exclude:" line of the rules, verbatim and in order. */
export const FIXED_EXCLUSIONS = [
  "taxes",
  "unmeasured materials",
  "unresolved materials",
  "hidden materials",
  "business interruption",
  "engineering design",
  "permit costs",
] as const;

export type RateResolution =
  | { ok: true; rate: Rate }
  | { ok: false; reason: "NO_RATE_REF" }
  | { ok: false; reason: "UNKNOWN_RATE_REF"; rateRef: string }
  | { ok: false; reason: "RATE_UNIT_MISMATCH"; rate: Rate };

/**
 * Looks up the rate for a zone. A rate applies only when its unit equals the zone unit;
 * there is no fallback to another rate and no unit conversion.
 */
export function resolveRate(rateRef: string | null, unit: Unit, rateCard: RateCard = RATE_CARD): RateResolution {
  const ref = rateRef?.trim() ?? "";
  if (ref === "") return { ok: false, reason: "NO_RATE_REF" };
  const rate = Object.hasOwn(rateCard, ref) ? rateCard[ref] : undefined;
  if (rate === undefined) return { ok: false, reason: "UNKNOWN_RATE_REF", rateRef: ref };
  if (rate.unit !== unit) return { ok: false, reason: "RATE_UNIT_MISMATCH", rate };
  return { ok: true, rate };
}
