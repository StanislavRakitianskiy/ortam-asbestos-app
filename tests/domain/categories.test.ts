import { describe, expect, it } from "vitest";
import { CATEGORY_TITLES, categorize } from "@/domain/categories";
import { matchProject } from "@/domain/matching";
import type { AcceptedLabResult, MaterialZone } from "@/domain/types";
import { byMaterial, demoResults, demoZones, labRow, withZone } from "../fixtures/demoProject";

function categorizeAll(zones: MaterialZone[], results: AcceptedLabResult[] = demoResults()) {
  const match = matchProject(zones, results);
  return Object.fromEntries(
    zones.map((zone) => [zone.materialId, categorize(zone, byMaterial(match.zones, zone.materialId))]),
  );
}

describe("categorize on the supplied demo data", () => {
  const result = categorizeAll(demoZones());

  it("applies the golden categories", () => {
    expect(Object.fromEntries(Object.entries(result).map(([id, found]) => [id, found.category]))).toEqual({
      M01: "A",
      M02: "A",
      M03: "A",
      M04: "D",
      M05: "B",
      M06: "C",
      M07: "C",
    });
  });

  it("names the reasons behind each category", () => {
    expect(result.M01.reasonCodes).toEqual(["DETECTED", "CONDITION_POOR"]);
    expect(result.M02.reasonCodes).toEqual(["DETECTED", "PLANNED_DISTURBANCE"]);
    expect(result.M03.reasonCodes).toEqual(["DETECTED", "CONDITION_DAMAGED", "PLANNED_DISTURBANCE"]);
    expect(result.M04.reasonCodes).toEqual(["NOT_DETECTED_IN_SAMPLED_MATERIAL"]);
    expect(result.M05.reasonCodes).toEqual(["DETECTED", "NO_PRIORITY_TRIGGER"]);
    expect(result.M06.reasonCodes).toEqual(["INCONCLUSIVE_RESULT"]);
    expect(result.M07.reasonCodes).toEqual(["INACCESSIBLE"]);
  });

  it("explains each category with its source samples and layers", () => {
    expect(result.M02.reasonText).toBe(
      "Asbestos detected in S02 (Black adhesive); disturbance is planned. Flag for priority professional review before affected work.",
    );
    expect(result.M03.reasonText).toContain("S03 (Textured coating), S07 (Textured coating); condition is damaged and disturbance is planned");
    expect(result.M05.reasonText).toBe(
      "Asbestos detected in S05 (Cement panel); condition is intact and no disturbance is planned. Flag for professional management review; no automatic removal conclusion.",
    );
    expect(result.M04.reasonText).toBe(
      "Asbestos not detected in S04 (Plaster). This finding applies only to the sampled material; no asbestos-specific cost in this exercise.",
    );
    expect(result.M06.reasonText).toContain("inconclusive for S06 (Insulation fragment)");
    expect(result.M07.reasonText).toContain("inaccessible");
  });

  it("never claims safety, clearance, compliance or building-wide absence", () => {
    for (const found of Object.values(result)) {
      expect(found.reasonText).not.toMatch(
        /\bsafe\b|\bclear(ed|ance)?\b|complian|asbestos[- ]free|free of asbestos|no asbestos (is )?present/i,
      );
    }
  });

  it("has the category titles from the brief", () => {
    expect(CATEGORY_TITLES).toEqual({
      A: "Priority professional review",
      B: "Professional management review",
      C: "Resolve missing evidence",
      D: "Record sampled finding",
    });
  });
});

describe("categorize rules", () => {
  it("puts a conflicting S04 in C", () => {
    const conflict = labRow({ labReportId: "LAB-D", sampleId: "S04", layer: "Plaster", resultLabel: "DETECTED" });
    const found = categorizeAll(demoZones(), [...demoResults(), conflict]).M04;
    expect(found).toMatchObject({ category: "C", reasonCodes: ["CONFLICTING_RESULT"] });
    expect(found.reasonText).toContain("conflict for S04 (Plaster)");
  });

  it("puts a zone awaiting a result in C", () => {
    const found = categorizeAll(withZone(demoZones(), "M04", { sampleIds: ["S04", "S08"] })).M04;
    expect(found).toMatchObject({ category: "C", reasonCodes: ["AWAITING_RESULT"] });
    expect(found.reasonText).toContain("No lab result yet for S08.");
  });

  it("puts an accessible unsampled zone in C", () => {
    expect(categorizeAll(withZone(demoZones(), "M07", { accessible: true })).M07).toMatchObject({
      category: "C",
      reasonCodes: ["UNSAMPLED"],
    });
  });

  it("uses B for detected material in unknown condition without planned disturbance", () => {
    expect(categorizeAll(withZone(demoZones(), "M05", { condition: "unknown" })).M05.category).toBe("B");
  });

  it("uses A for detected material once disturbance is planned", () => {
    expect(categorizeAll(withZone(demoZones(), "M05", { plannedDisturbance: true })).M05.category).toBe("A");
  });

  it("does not let condition or disturbance change C or D", () => {
    let zones = withZone(demoZones(), "M04", { condition: "poor", plannedDisturbance: true });
    zones = withZone(zones, "M06", { condition: "damaged", plannedDisturbance: true });
    const result = categorizeAll(zones);
    expect(result.M04.category).toBe("D");
    expect(result.M06.category).toBe("C");
  });

  it("refuses a match that belongs to another zone", () => {
    const zones = demoZones();
    const match = matchProject(zones, demoResults());
    expect(() => categorize(byMaterial(zones, "M01"), byMaterial(match.zones, "M02"))).toThrow(/M02.*M01/);
  });
});
