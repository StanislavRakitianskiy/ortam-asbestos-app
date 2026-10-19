import { describe, expect, it } from "vitest";
import { acceptedLabResultSchema, materialZoneSchema } from "@/domain/types";
import { byMaterial, demoResults, demoZones } from "../fixtures/demoProject";

const m01 = () => byMaterial(demoZones(), "M01");
const zoneWith = (patch: Record<string, unknown>) => materialZoneSchema.safeParse({ ...m01(), ...patch });
const resultWith = (patch: Record<string, unknown>) =>
  acceptedLabResultSchema.safeParse({ ...demoResults()[0], ...patch });

describe("materialZoneSchema", () => {
  it("accepts every demo zone, including unknown quantities", () => {
    for (const zone of demoZones()) expect(materialZoneSchema.parse(zone)).toEqual(zone);
    expect(zoneWith({ quantity: null }).success).toBe(true);
    expect(zoneWith({ quantity: 12.35 }).success).toBe(true);
  });

  it("rejects zero, negative and over-precise quantities instead of coercing them", () => {
    expect(zoneWith({ quantity: 0 }).success).toBe(false);
    expect(zoneWith({ quantity: -5 }).success).toBe(false);
    expect(zoneWith({ quantity: 1.234 }).success).toBe(false);
    expect(zoneWith({ quantity: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(zoneWith({ quantity: undefined }).success).toBe(false);
  });

  it("accepts only the exact unit and condition values", () => {
    expect(zoneWith({ unit: "m²" }).success).toBe(false);
    expect(zoneWith({ unit: "linear m" }).success).toBe(false);
    expect(zoneWith({ condition: "good" }).success).toBe(false);
    expect(zoneWith({ condition: "Poor" }).success).toBe(false);
  });

  it("requires a boolean planned disturbance and non-blank IDs", () => {
    expect(zoneWith({ plannedDisturbance: "Yes" }).success).toBe(false);
    expect(zoneWith({ sampleIds: ["S01", "  "] }).success).toBe(false);
    expect(zoneWith({ materialId: "" }).success).toBe(false);
    expect(zoneWith({ rateRef: " " }).success).toBe(false);
  });
});

describe("acceptedLabResultSchema", () => {
  it("accepts every demo lab row", () => {
    for (const result of demoResults()) expect(acceptedLabResultSchema.parse(result)).toEqual(result);
  });

  it("accepts only the explicit result labels", () => {
    expect(resultWith({ resultLabel: "POSITIVE" }).success).toBe(false);
    expect(resultWith({ resultLabel: "detected" }).success).toBe(false);
  });

  it("requires evidence: a positive integer page and non-blank source text", () => {
    expect(resultWith({ page: 0 }).success).toBe(false);
    expect(resultWith({ page: 1.5 }).success).toBe(false);
    expect(resultWith({ sourceText: " " }).success).toBe(false);
  });

  it("keeps percentage within 0..100 or null", () => {
    expect(resultWith({ percentage: null }).success).toBe(true);
    expect(resultWith({ percentage: 101 }).success).toBe(false);
  });
});
