import type { LayerStatus, ZoneMatch } from "./matching";
import type { Category, MaterialZone } from "./types";

export const CATEGORY_TITLES: Record<Category, string> = {
  A: "Priority professional review",
  B: "Professional management review",
  C: "Resolve missing evidence",
  D: "Record sampled finding",
};

export type CategoryReasonCode =
  | "DETECTED"
  | "CONDITION_POOR"
  | "CONDITION_DAMAGED"
  | "PLANNED_DISTURBANCE"
  | "NO_PRIORITY_TRIGGER"
  | "NOT_DETECTED_IN_SAMPLED_MATERIAL"
  | "INCONCLUSIVE_RESULT"
  | "CONFLICTING_RESULT"
  | "AWAITING_RESULT"
  | "UNSAMPLED"
  | "INACCESSIBLE";

export interface Categorization {
  category: Category;
  reasonCodes: CategoryReasonCode[];
  /** Deterministic explanation built in code, never by AI. */
  reasonText: string;
}

const UNRESOLVED = "Resolve the evidence gap; the asbestos status stays unknown until then.";

/** Applies exercise categories A–D from the zone's matched status, condition and planned disturbance. */
export function categorize(zone: MaterialZone, match: ZoneMatch): Categorization {
  if (zone.id !== match.zoneId) {
    throw new Error(`Match for zone ${match.materialId} was passed with zone ${zone.materialId}.`);
  }

  switch (match.zoneStatus) {
    case "DETECTED": {
      const triggers: { code: CategoryReasonCode; text: string }[] = [];
      if (zone.condition === "poor") triggers.push({ code: "CONDITION_POOR", text: "condition is poor" });
      if (zone.condition === "damaged") triggers.push({ code: "CONDITION_DAMAGED", text: "condition is damaged" });
      if (zone.plannedDisturbance) triggers.push({ code: "PLANNED_DISTURBANCE", text: "disturbance is planned" });
      const found = `Asbestos detected in ${describeLayers(match, "DETECTED")}`;
      if (triggers.length > 0) {
        return {
          category: "A",
          reasonCodes: ["DETECTED", ...triggers.map((trigger) => trigger.code)],
          reasonText: `${found}; ${triggers.map((trigger) => trigger.text).join(" and ")}. Flag for priority professional review before affected work.`,
        };
      }
      return {
        category: "B",
        reasonCodes: ["DETECTED", "NO_PRIORITY_TRIGGER"],
        reasonText: `${found}; condition is ${zone.condition} and no disturbance is planned. Flag for professional management review; no automatic removal conclusion.`,
      };
    }
    case "NOT_DETECTED":
      return {
        category: "D",
        reasonCodes: ["NOT_DETECTED_IN_SAMPLED_MATERIAL"],
        reasonText: `Asbestos not detected in ${describeLayers(match, "NOT_DETECTED")}. This finding applies only to the sampled material; no asbestos-specific cost in this exercise.`,
      };
    case "INCONCLUSIVE":
      return {
        category: "C",
        reasonCodes: ["INCONCLUSIVE_RESULT"],
        reasonText: `Lab result is inconclusive for ${describeLayers(match, "INCONCLUSIVE")}. ${UNRESOLVED}`,
      };
    case "CONFLICT":
      return {
        category: "C",
        reasonCodes: ["CONFLICTING_RESULT"],
        reasonText: `Lab results conflict for ${describeLayers(match, "CONFLICT")}. ${UNRESOLVED}`,
      };
    case "AWAITING_RESULT": {
      const awaiting = match.samples.filter((sample) => sample.layers.length === 0).map((sample) => sample.sampleId);
      return {
        category: "C",
        reasonCodes: ["AWAITING_RESULT"],
        reasonText: `No lab result yet for ${awaiting.join(", ")}. ${UNRESOLVED}`,
      };
    }
    case "UNSAMPLED":
      return {
        category: "C",
        reasonCodes: ["UNSAMPLED"],
        reasonText: `No sample was taken from this zone. ${UNRESOLVED}`,
      };
    case "INACCESSIBLE":
      return {
        category: "C",
        reasonCodes: ["INACCESSIBLE"],
        reasonText: `The zone was inaccessible and no sample was taken. ${UNRESOLVED}`,
      };
  }
}

/** "S02 (Black adhesive), S03 (Textured coating)" for the layers with the given status. */
function describeLayers(match: ZoneMatch, status: LayerStatus): string {
  return match.samples
    .flatMap((sample) =>
      sample.layers.filter((layer) => layer.status === status).map((layer) => `${sample.sampleId} (${layer.layer})`),
    )
    .join(", ");
}
