import { RATE_CARD, resolveRate, type RateCard } from "./rates";
import { normalizeSampleId } from "./sampleId";
import type { MaterialZone, Unit } from "./types";

/**
 * Hints shown while the employee fills in a zone, before any lab result exists. They never block saving:
 * after the lab results are in, matching turns the relevant ones into review issues.
 */
export type ZoneWarning =
  | { type: "RATE_UNIT_MISMATCH"; message: string }
  | { type: "UNKNOWN_RATE_REF"; message: string }
  | { type: "SAMPLE_IN_OTHER_ZONE"; sampleId: string; otherMaterialIds: string[]; message: string }
  | { type: "UNKNOWN_QUANTITY"; message: string };

/** A saved zone, or the form while it is being filled in. */
export type ZoneDraft = {
  /** Set when editing, so the zone is not compared with itself. */
  id?: string;
  sampleIds: readonly string[];
  /** null = Unknown; undefined = nothing entered yet. */
  quantity?: number | null;
  /** null while no unit is chosen; the rate checks wait for it. */
  unit: Unit | null;
  rateRef: string | null;
};
type OtherZone = Pick<MaterialZone, "id" | "materialId" | "sampleIds">;

export function zoneWarnings(
  zone: ZoneDraft,
  zones: readonly OtherZone[],
  rateCard: RateCard = RATE_CARD,
): ZoneWarning[] {
  const warnings: ZoneWarning[] = [];

  const rate = zone.unit === null ? null : resolveRate(zone.rateRef, zone.unit, rateCard);
  if (rate && !rate.ok && rate.reason === "RATE_UNIT_MISMATCH") {
    warnings.push({
      type: "RATE_UNIT_MISMATCH",
      message: `${rate.rate.ref} is priced per ${rate.rate.unit}; this zone is ${zone.unit} — it will not be priced.`,
    });
  }
  if (rate && !rate.ok && rate.reason === "UNKNOWN_RATE_REF") {
    warnings.push({
      type: "UNKNOWN_RATE_REF",
      message: `${rate.rateRef} is not on the rate card — this zone will not be priced.`,
    });
  }

  const others = zones.filter((other) => other.id !== zone.id);
  for (const sampleId of new Set(zone.sampleIds.map(normalizeSampleId))) {
    const otherMaterialIds = others
      .filter((other) => other.sampleIds.some((id) => normalizeSampleId(id) === sampleId))
      .map((other) => other.materialId);
    if (otherMaterialIds.length === 0) continue;
    warnings.push({
      type: "SAMPLE_IN_OTHER_ZONE",
      sampleId,
      otherMaterialIds,
      message: `${sampleId} is already listed in zone ${otherMaterialIds.join(", ")}. A sample should belong to one zone; until it does, it is a review issue.`,
    });
  }

  if (zone.quantity === null) {
    warnings.push({ type: "UNKNOWN_QUANTITY", message: "Will be shown as Not priced if asbestos is detected." });
  }
  return warnings;
}
