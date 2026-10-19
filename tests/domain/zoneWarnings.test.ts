import { describe, expect, it } from "vitest";
import { zoneWarnings } from "@/domain/zoneWarnings";
import { byMaterial, demoZones, withZone } from "../fixtures/demoProject";

const types = (warnings: { type: string }[]) => warnings.map((warning) => warning.type);

describe("zoneWarnings", () => {
  it("has nothing to say about a complete, consistent zone", () => {
    const zones = demoZones();
    expect(zoneWarnings(byMaterial(zones, "M01"), zones)).toEqual([]);
    expect(zoneWarnings(byMaterial(zones, "M03"), zones)).toEqual([]);
  });

  it("explains a rate whose unit differs from the zone unit", () => {
    const zones = withZone(demoZones(), "M01", { unit: "m2" });
    const [warning] = zoneWarnings(byMaterial(zones, "M01"), zones);
    expect(warning).toEqual({
      type: "RATE_UNIT_MISMATCH",
      message: "R_PIPE is priced per linear_m; this zone is m2 — it will not be priced.",
    });
  });

  it("flags a rate reference that is not on the rate card", () => {
    const zones = withZone(demoZones(), "M01", { rateRef: "R_WALL" });
    expect(types(zoneWarnings(byMaterial(zones, "M01"), zones))).toEqual(["UNKNOWN_RATE_REF"]);
  });

  it("does not warn when no rate is assigned", () => {
    const zones = demoZones();
    expect(zoneWarnings(byMaterial(zones, "M04"), zones)).toEqual([]);
  });

  it("names the other zone that already lists a sample ID, comparing normalized IDs", () => {
    const zones = demoZones();
    const draft = { sampleIds: [" s07 "], quantity: 10, unit: "m2" as const, rateRef: null };
    const [warning] = zoneWarnings(draft, zones);
    expect(warning).toMatchObject({ type: "SAMPLE_IN_OTHER_ZONE", sampleId: "S07", otherMaterialIds: ["M03"] });
  });

  it("does not compare a zone with itself when editing", () => {
    const zones = demoZones();
    const m03 = byMaterial(zones, "M03");
    expect(zoneWarnings({ ...m03, sampleIds: ["S03", "S07"] }, zones)).toEqual([]);
  });

  it("waits for a unit before checking the rate, and for an entry before calling a quantity unknown", () => {
    const draft = { sampleIds: [], unit: null, rateRef: "R_PIPE" };
    expect(zoneWarnings(draft, demoZones())).toEqual([]);
    expect(types(zoneWarnings({ ...draft, quantity: null }, demoZones()))).toEqual(["UNKNOWN_QUANTITY"]);
  });

  it("reminds that an unknown quantity will not be priced", () => {
    const zones = demoZones();
    expect(zoneWarnings(byMaterial(zones, "M05"), zones)).toEqual([
      { type: "UNKNOWN_QUANTITY", message: "Will be shown as Not priced if asbestos is detected." },
    ]);
  });
});
