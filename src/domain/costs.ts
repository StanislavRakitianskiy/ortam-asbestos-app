import type { ZoneMatch } from "./matching";
import {
  CONTINGENCY_PERCENT,
  FIXED_EXCLUSIONS,
  MOBILIZATION,
  PROFESSIONAL_ASSESSMENT,
  RATE_CARD,
  resolveRate,
  type RateCard,
  type RateResolution,
} from "./rates";
import type { Cents, MaterialZone, Unit, ZoneStatus } from "./types";

export type NotPricedReason = "MISSING_QUANTITY" | "MISSING_RATE" | "UNKNOWN_RATE_REF" | "RATE_UNIT_MISMATCH";

interface CostLineBase {
  zoneId: string;
  materialId: string;
  description: string;
  quantity: number | null;
  unit: Unit;
  rateRef: string | null;
  /** Cents per unit; null unless the rate is valid for the zone unit. */
  removalRate: Cents | null;
  /** Cents per unit; null unless the rate is valid for the zone unit. */
  replacementRate: Cents | null;
}

export interface PricedCostLine extends CostLineBase {
  status: "PRICED";
  quantity: number;
  removalRate: Cents;
  replacementRate: Cents;
  removalAmount: Cents;
  replacementAmount: Cents;
  lineTotal: Cents;
  notPricedReason: null;
}

export interface NotPricedCostLine extends CostLineBase {
  status: "NOT_PRICED";
  removalAmount: null;
  replacementAmount: null;
  lineTotal: null;
  notPricedReason: NotPricedReason;
}

export type CostLine = PricedCostLine | NotPricedCostLine;

export type ExclusionReason = "FIXED" | NotPricedReason | "UNRESOLVED";

export interface Exclusion {
  reason: ExclusionReason;
  zoneId: string | null;
  materialId: string | null;
  text: string;
}

/** Every amount is integer cents (CAD, before tax). */
export interface CostEstimate {
  /** One line per detected zone, priced or not. Not-detected and unresolved zones have no line. */
  lines: CostLine[];
  removalSubtotal: Cents;
  replacementSubtotal: Cents;
  zoneSubtotal: Cents;
  mobilization: Cents;
  assessment: Cents;
  direct: Cents;
  contingency: Cents;
  total: Cents;
  /** The fixed exclusions from the rules, then one entry per not-priced or unresolved zone. */
  exclusions: Exclusion[];
}

export interface EstimateOptions {
  rateCard?: RateCard;
}

type UnresolvedStatus = Exclude<ZoneStatus, "DETECTED" | "NOT_DETECTED">;

const UNRESOLVED_TEXT: Record<UnresolvedStatus, string> = {
  INCONCLUSIVE: "inconclusive lab result",
  CONFLICT: "conflicting lab results",
  AWAITING_RESULT: "lab result not yet received",
  UNSAMPLED: "not sampled",
  INACCESSIBLE: "inaccessible and not sampled",
};

const NOT_PRICED_BY_RATE: Record<Exclude<RateResolution, { ok: true }>["reason"], NotPricedReason> = {
  NO_RATE_REF: "MISSING_RATE",
  UNKNOWN_RATE_REF: "UNKNOWN_RATE_REF",
  RATE_UNIT_MISMATCH: "RATE_UNIT_MISMATCH",
};

/**
 * The fictional removal and replacement scenario. Only detected zones with a known quantity and a rate in the
 * zone's unit are priced; the quantity is the zone's, however many samples it has.
 */
export function computeEstimate(
  zones: readonly MaterialZone[],
  matches: readonly ZoneMatch[],
  options: EstimateOptions = {},
): CostEstimate {
  const rateCard = options.rateCard ?? RATE_CARD;
  const statusByZone = new Map(matches.map((match) => [match.zoneId, match.zoneStatus]));
  const lines: CostLine[] = [];
  const zoneExclusions: Exclusion[] = [];

  for (const zone of zones) {
    const status = statusByZone.get(zone.id);
    if (status === undefined) throw new Error(`No match result for zone ${zone.materialId} (${zone.id}).`);
    // Category D: no asbestos-specific cost and no line.
    if (status === "NOT_DETECTED") continue;
    if (status !== "DETECTED") {
      zoneExclusions.push(zoneExclusion(zone, "UNRESOLVED", `unresolved (${UNRESOLVED_TEXT[status]})`));
      continue;
    }
    const line = priceZone(zone, rateCard);
    lines.push(line);
    if (line.status === "NOT_PRICED") {
      zoneExclusions.push(zoneExclusion(zone, line.notPricedReason, notPricedDetail(zone, line.notPricedReason)));
    }
  }

  const priced = lines.filter((line): line is PricedCostLine => line.status === "PRICED");
  const removalSubtotal = sum(priced.map((line) => line.removalAmount));
  const replacementSubtotal = sum(priced.map((line) => line.replacementAmount));
  const zoneSubtotal = removalSubtotal + replacementSubtotal;
  const mobilization = priced.length > 0 ? MOBILIZATION : 0;
  const assessment = priced.length > 0 ? PROFESSIONAL_ASSESSMENT : 0;
  const direct = zoneSubtotal + mobilization + assessment;
  const contingency = roundHalfUp(direct * CONTINGENCY_PERCENT, 100);

  return {
    lines,
    removalSubtotal,
    replacementSubtotal,
    zoneSubtotal,
    mobilization,
    assessment,
    direct,
    contingency,
    total: direct + contingency,
    exclusions: [
      ...FIXED_EXCLUSIONS.map((text): Exclusion => ({ reason: "FIXED", zoneId: null, materialId: null, text })),
      ...zoneExclusions,
    ],
  };
}

function priceZone(zone: MaterialZone, rateCard: RateCard): CostLine {
  const rate = resolveRate(zone.rateRef, zone.unit, rateCard);
  const base: CostLineBase = {
    zoneId: zone.id,
    materialId: zone.materialId,
    description: zone.description,
    quantity: zone.quantity,
    unit: zone.unit,
    rateRef: zone.rateRef,
    // A rate in another unit is never shown as if it applied.
    removalRate: rate.ok ? rate.rate.removalRate : null,
    replacementRate: rate.ok ? rate.rate.replacementRate : null,
  };
  const notPriced = (reason: NotPricedReason): NotPricedCostLine => ({
    ...base,
    status: "NOT_PRICED",
    removalAmount: null,
    replacementAmount: null,
    lineTotal: null,
    notPricedReason: reason,
  });

  if (zone.quantity === null) return notPriced("MISSING_QUANTITY");
  if (!rate.ok) return notPriced(NOT_PRICED_BY_RATE[rate.reason]);

  const hundredths = toHundredths(zone.quantity);
  const removalAmount = amount(hundredths, rate.rate.removalRate);
  const replacementAmount = amount(hundredths, rate.rate.replacementRate);
  return {
    ...base,
    status: "PRICED",
    quantity: zone.quantity,
    removalRate: rate.rate.removalRate,
    replacementRate: rate.rate.replacementRate,
    removalAmount,
    replacementAmount,
    lineTotal: removalAmount + replacementAmount,
    notPricedReason: null,
  };
}

function notPricedDetail(zone: MaterialZone, reason: NotPricedReason): string {
  switch (reason) {
    case "MISSING_QUANTITY":
      return "detected, quantity not measured";
    case "MISSING_RATE":
      return "detected, no rate reference assigned";
    case "UNKNOWN_RATE_REF":
      return `detected, rate ${zone.rateRef} is not on the rate card`;
    case "RATE_UNIT_MISMATCH":
      return `detected, zone unit ${zone.unit} does not match the unit of rate ${zone.rateRef}`;
  }
}

function zoneExclusion(zone: MaterialZone, reason: ExclusionReason, detail: string): Exclusion {
  return {
    reason,
    zoneId: zone.id,
    materialId: zone.materialId,
    text: `${zone.materialId} ${zone.description}: ${detail}; not priced.`,
  };
}

/** The schema limits quantities to two decimals, so this conversion is exact. */
function toHundredths(quantity: number): number {
  return Math.round(quantity * 100);
}

/** Quantity in hundredths of a unit × cents per unit, rounded half-up to whole cents. */
function amount(quantityHundredths: number, rate: Cents): Cents {
  const product = quantityHundredths * rate;
  if (!Number.isSafeInteger(product)) throw new RangeError("Cost amount is too large to compute exactly.");
  return roundHalfUp(product, 100);
}

/** Integer division of non-negative integers, rounding halves up. */
function roundHalfUp(numerator: number, denominator: number): number {
  const quotient = Math.floor(numerator / denominator);
  return 2 * (numerator - quotient * denominator) >= denominator ? quotient + 1 : quotient;
}

function sum(values: readonly Cents[]): Cents {
  return values.reduce((total, value) => total + value, 0);
}
