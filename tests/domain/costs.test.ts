import { describe, expect, it } from "vitest";
import { computeEstimate } from "@/domain/costs";
import { formatCad } from "@/domain/format";
import { matchProject } from "@/domain/matching";
import { FIXED_EXCLUSIONS, type RateCard } from "@/domain/rates";
import type { AcceptedLabResult, MaterialZone } from "@/domain/types";
import { byMaterial, demoResults, demoZones, labRow, withZone } from "../fixtures/demoProject";

function estimate(zones: MaterialZone[], results: AcceptedLabResult[] = demoResults(), rateCard?: RateCard) {
  return computeEstimate(zones, matchProject(zones, results, { rateCard }).zones, { rateCard });
}

const totals = (found: ReturnType<typeof estimate>) => ({
  removal: formatCad(found.removalSubtotal),
  replacement: formatCad(found.replacementSubtotal),
  zone: formatCad(found.zoneSubtotal),
  mobilization: formatCad(found.mobilization),
  assessment: formatCad(found.assessment),
  direct: formatCad(found.direct),
  contingency: formatCad(found.contingency),
  total: formatCad(found.total),
});

describe("computeEstimate on the supplied demo data", () => {
  const found = estimate(demoZones());

  it("has one line per detected zone only", () => {
    expect(found.lines.map((line) => [line.materialId, line.status, line.notPricedReason])).toEqual([
      ["M01", "PRICED", null],
      ["M02", "PRICED", null],
      ["M03", "PRICED", null],
      ["M05", "NOT_PRICED", "MISSING_QUANTITY"],
    ]);
  });

  it("prices M01–M03 per the rules", () => {
    expect(
      found.lines.map((line) => [
        line.materialId,
        line.lineTotal === null ? null : formatCad(line.lineTotal),
        line.removalAmount === null ? null : formatCad(line.removalAmount),
        line.replacementAmount === null ? null : formatCad(line.replacementAmount),
      ]),
    ).toEqual([
      ["M01", "3,840.00", "2,880.00", "960.00"],
      ["M02", "7,200.00", "4,050.00", "3,150.00"],
      ["M03", "12,600.00", "8,400.00", "4,200.00"],
      ["M05", null, null, null],
    ]);
  });

  it("charges M03 once for 140 m2 although it has two samples", () => {
    const m03Lines = found.lines.filter((line) => line.zoneId === "zone-m03");
    expect(m03Lines).toHaveLength(1);
    expect(m03Lines[0]).toMatchObject({ quantity: 140, unit: "m2", removalRate: 6_000, replacementRate: 3_000 });
  });

  it("keeps M05 visible as Not priced with its rate but no amounts, and lists it as an exclusion", () => {
    expect(byMaterial(found.lines, "M05")).toEqual({
      zoneId: "zone-m05",
      materialId: "M05",
      description: "Cement panel",
      quantity: null,
      unit: "m2",
      rateRef: "R_PANEL",
      removalRate: 8_500,
      replacementRate: 6_500,
      status: "NOT_PRICED",
      removalAmount: null,
      replacementAmount: null,
      lineTotal: null,
      notPricedReason: "MISSING_QUANTITY",
    });
    expect(byMaterial(found.exclusions, "M05")).toEqual({
      reason: "MISSING_QUANTITY",
      zoneId: "zone-m05",
      materialId: "M05",
      text: "M05 Cement panel: detected, quantity not measured; not priced.",
    });
  });

  it("gives M04 (not detected) no line and no exclusion", () => {
    expect(found.lines.some((line) => line.materialId === "M04")).toBe(false);
    expect(found.exclusions.some((exclusion) => exclusion.materialId === "M04")).toBe(false);
  });

  it("lists the fixed exclusions, then M05, M06 and M07", () => {
    expect(found.exclusions.slice(0, 7)).toEqual(
      FIXED_EXCLUSIONS.map((text) => ({ reason: "FIXED", zoneId: null, materialId: null, text })),
    );
    expect(found.exclusions.slice(7).map((exclusion) => [exclusion.reason, exclusion.text])).toEqual([
      ["MISSING_QUANTITY", "M05 Cement panel: detected, quantity not measured; not priced."],
      ["UNRESOLVED", "M06 Insulation fragment: unresolved (inconclusive lab result); not priced."],
      ["UNRESOLVED", "M07 Uninspected riser material: unresolved (inaccessible and not sampled); not priced."],
    ]);
  });

  it("matches the golden totals", () => {
    expect(totals(found)).toEqual({
      removal: "15,330.00",
      replacement: "8,310.00",
      zone: "23,640.00",
      mobilization: "2,500.00",
      assessment: "1,200.00",
      direct: "27,340.00",
      contingency: "5,468.00",
      total: "32,808.00",
    });
    expect(found.total).toBe(3_280_800);
  });
});

describe("computeEstimate scenarios", () => {
  it("reproduces the brief's arithmetic example", () => {
    const rateCard: RateCard = {
      R_EXAMPLE: { ref: "R_EXAMPLE", material: "Example", unit: "m2", removalRate: 5_000, replacementRate: 2_000 },
    };
    const zone: MaterialZone = {
      ...byMaterial(demoZones(), "M02"),
      id: "zone-x01",
      materialId: "X01",
      sampleIds: ["X1"],
      quantity: 10,
      rateRef: "R_EXAMPLE",
    };
    const result = labRow({ labReportId: "LAB-X", sampleId: "X1", layer: "Example", resultLabel: "DETECTED" });
    const found = estimate([zone], [result], rateCard);
    expect(formatCad(found.lines[0].lineTotal ?? -1)).toBe("700.00");
    expect(totals(found)).toMatchObject({ direct: "4,400.00", contingency: "880.00", total: "5,280.00" });
  });

  it("adds no allowances and totals zero when no zone is priced", () => {
    const zones = demoZones().filter((zone) => ["M04", "M05", "M06", "M07"].includes(zone.materialId));
    const found = estimate(zones);
    expect(found.lines.map((line) => line.status)).toEqual(["NOT_PRICED"]);
    expect([found.mobilization, found.assessment, found.direct, found.contingency, found.total]).toEqual([0, 0, 0, 0, 0]);
  });

  it("adds no allowances when nothing is detected", () => {
    const found = estimate(demoZones().filter((zone) => zone.materialId === "M04"));
    expect(found.lines).toEqual([]);
    expect(found.total).toBe(0);
    expect(found.exclusions).toHaveLength(FIXED_EXCLUSIONS.length);
  });

  it("recalculates when M03's quantity changes to 150 m2", () => {
    const found = estimate(withZone(demoZones(), "M03", { quantity: 150 }));
    expect(formatCad(byMaterial(found.lines, "M03").lineTotal ?? -1)).toBe("13,500.00");
    expect(formatCad(found.total)).toBe("33,888.00");
  });

  it("never applies the pipe rate to M01 measured in m2", () => {
    const found = estimate(withZone(demoZones(), "M01", { unit: "m2" }));
    expect(byMaterial(found.lines, "M01")).toMatchObject({
      status: "NOT_PRICED",
      notPricedReason: "RATE_UNIT_MISMATCH",
      removalRate: null,
      replacementRate: null,
      lineTotal: null,
    });
    expect(byMaterial(found.exclusions, "M01").text).toBe(
      "M01 Pipe insulation: detected, zone unit m2 does not match the unit of rate R_PIPE; not priced.",
    );
    expect(totals(found)).toMatchObject({ zone: "19,800.00", direct: "23,500.00", total: "28,200.00" });
  });

  it("marks detected zones with no or an unknown rate reference as Not priced", () => {
    let zones = withZone(demoZones(), "M01", { rateRef: null });
    zones = withZone(zones, "M02", { rateRef: "R_TILE" });
    const found = estimate(zones);
    expect(byMaterial(found.lines, "M01").notPricedReason).toBe("MISSING_RATE");
    expect(byMaterial(found.lines, "M02").notPricedReason).toBe("UNKNOWN_RATE_REF");
    expect(byMaterial(found.exclusions, "M01").text).toContain("no rate reference assigned");
    expect(byMaterial(found.exclusions, "M02").text).toContain("rate R_TILE is not on the rate card");
    expect(formatCad(found.zoneSubtotal)).toBe("12,600.00");
  });

  it("excludes conflicting, awaiting and unsampled zones as unresolved", () => {
    let zones = withZone(demoZones(), "M01", { sampleIds: ["S08"] });
    zones = withZone(zones, "M07", { accessible: true });
    const conflict = labRow({ labReportId: "LAB-D", sampleId: "S04", layer: "Plaster", resultLabel: "DETECTED" });
    const found = estimate(zones, [...demoResults(), conflict]);
    expect(found.lines.some((line) => ["M01", "M04", "M07"].includes(line.materialId))).toBe(false);
    expect(byMaterial(found.exclusions, "M01").text).toContain("unresolved (lab result not yet received)");
    expect(byMaterial(found.exclusions, "M04").text).toContain("unresolved (conflicting lab results)");
    expect(byMaterial(found.exclusions, "M07").text).toContain("unresolved (not sampled)");
  });

  it("rounds each amount half-up to the cent and keeps line = removal + replacement", () => {
    const rateCard: RateCard = {
      R_ODD: { ref: "R_ODD", material: "Odd", unit: "m2", removalRate: 5_050, replacementRate: 2_025 },
    };
    const zone: MaterialZone = { ...byMaterial(demoZones(), "M02"), sampleIds: ["S02"], quantity: 0.01, rateRef: "R_ODD" };
    const found = estimate([zone], demoResults(), rateCard);
    expect(found.lines[0]).toMatchObject({ removalAmount: 51, replacementAmount: 20, lineTotal: 71 });
  });

  it("handles decimal quantities exactly", () => {
    const found = estimate(withZone(demoZones(), "M02", { quantity: 12.35 }));
    expect(byMaterial(found.lines, "M02")).toMatchObject({ removalAmount: 55_575, replacementAmount: 43_225 });
  });

  it("refuses amounts too large to compute exactly", () => {
    expect(() => estimate(withZone(demoZones(), "M02", { quantity: 1e13 }))).toThrow(RangeError);
  });

  it("refuses a zone without a match result", () => {
    expect(() => computeEstimate(demoZones(), [])).toThrow("No match result for zone M01");
  });
});
