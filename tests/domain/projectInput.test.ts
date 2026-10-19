import { describe, expect, it } from "vitest";
import {
  projectCreateSchema,
  projectUpdateSchema,
  splitSampleIds,
  zoneCreateSchema,
  zoneUpdateSchema,
  type ZoneCreateInput,
} from "@/domain/projectInput";

const m05: ZoneCreateInput = {
  materialId: "M05",
  description: "Cement panel",
  floor: "Exterior",
  location: "E01 east elevation",
  sampleIds: ["S05"],
  quantity: null,
  unit: "m2",
  condition: "intact",
  plannedDisturbance: false,
  rateRef: "R_PANEL",
  accessible: true,
  notes: "Quantity not measured. Do not treat blank as zero.",
};

const zoneWith = (patch: Record<string, unknown>) => zoneCreateSchema.safeParse({ ...m05, ...patch });

const m05Without = (field: keyof ZoneCreateInput) => {
  const copy: Record<string, unknown> = { ...m05 };
  delete copy[field];
  return copy;
};

/** Field paths that failed, e.g. ["quantity"] or ["sampleIds.1"]. */
const failedFields = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.map(String).join("."));

describe("zoneCreateSchema: quantity", () => {
  it("keeps Unknown as null, never 0", () => {
    const zone = zoneCreateSchema.parse(m05);
    expect(zone.quantity).toBeNull();
    expect(zone.quantity).not.toBe(0);
  });

  it("requires an explicit quantity: a missing value is an error, not 0 or null", () => {
    expect(failedFields(zoneCreateSchema.safeParse(m05Without("quantity")))).toEqual(["quantity"]);
  });

  it("rejects negative and zero quantities with a message that points to Unknown", () => {
    const negative = zoneWith({ quantity: -5 });
    expect(failedFields(negative)).toEqual(["quantity"]);
    expect(negative.error?.issues[0].message).toContain("Unknown");
    expect(failedFields(zoneWith({ quantity: 0 }))).toEqual(["quantity"]);
  });

  it("does not coerce text or accept more than two decimals", () => {
    expect(failedFields(zoneWith({ quantity: "24" }))).toEqual(["quantity"]);
    expect(failedFields(zoneWith({ quantity: "" }))).toEqual(["quantity"]);
    expect(failedFields(zoneWith({ quantity: 1.234 }))).toEqual(["quantity"]);
    expect(zoneWith({ quantity: 12.35 }).data?.quantity).toBe(12.35);
  });
});

describe("zoneCreateSchema: units, condition and rate", () => {
  it("accepts only m2 and linear_m", () => {
    expect(zoneWith({ unit: "linear_m" }).success).toBe(true);
    for (const unit of ["m²", "linear m", "M2", "lm", ""]) expect(failedFields(zoneWith({ unit }))).toEqual(["unit"]);
  });

  it("accepts only the four supplied condition values", () => {
    for (const condition of ["intact", "damaged", "poor", "unknown"]) {
      expect(zoneWith({ condition }).success).toBe(true);
    }
    expect(failedFields(zoneWith({ condition: "good" }))).toEqual(["condition"]);
  });

  it("requires planned disturbance as a boolean", () => {
    expect(failedFields(zoneWith({ plannedDisturbance: "Yes" }))).toEqual(["plannedDisturbance"]);
  });

  it("accepts a rate reference from the rate card or null, defaulting to null", () => {
    expect(zoneWith({ rateRef: null }).data?.rateRef).toBeNull();
    expect(zoneCreateSchema.parse(m05Without("rateRef")).rateRef).toBeNull();
    expect(failedFields(zoneWith({ rateRef: "R_WALL" }))).toEqual(["rateRef"]);
  });

  it("does not check the rate unit here: a mismatch is a review warning, not an input error", () => {
    expect(zoneWith({ rateRef: "R_PIPE", unit: "m2" }).success).toBe(true);
  });
});

describe("zoneCreateSchema: IDs", () => {
  it("normalizes sample IDs and keeps their order", () => {
    expect(zoneWith({ sampleIds: [" s07 ", "S03"] }).data?.sampleIds).toEqual(["S07", "S03"]);
  });

  it("allows a zone without samples (unsampled or inaccessible)", () => {
    expect(zoneWith({ sampleIds: [], accessible: false }).data?.sampleIds).toEqual([]);
  });

  it("rejects a sample ID listed twice in one zone, after normalization", () => {
    expect(failedFields(zoneWith({ sampleIds: ["S03", "s03"] }))).toEqual(["sampleIds.1"]);
  });

  it("rejects blank IDs and several IDs typed as one", () => {
    expect(failedFields(zoneWith({ sampleIds: [" "] }))).toEqual(["sampleIds.0"]);
    expect(failedFields(zoneWith({ sampleIds: ["S03|S07"] }))).toEqual(["sampleIds.0"]);
  });

  it("never pads or rewrites an ID: S7 stays S7", () => {
    expect(zoneWith({ sampleIds: ["S7"] }).data?.sampleIds).toEqual(["S7"]);
  });

  it("uppercases the material ID and requires the descriptive fields", () => {
    expect(zoneWith({ materialId: " m05 " }).data?.materialId).toBe("M05");
    expect(failedFields(zoneWith({ materialId: "", location: "  " }))).toEqual(["materialId", "location"]);
  });

  it("rejects unknown fields instead of silently dropping them", () => {
    expect(failedFields(zoneWith({ qty: 5 }))).toEqual([""]);
  });
});

describe("zoneUpdateSchema", () => {
  it("treats a missing field as unchanged and null quantity as Unknown", () => {
    expect(zoneUpdateSchema.parse({ quantity: null })).toEqual({ quantity: null });
    expect(zoneUpdateSchema.parse({ notes: "Re-measured" })).not.toHaveProperty("quantity");
  });

  it("rejects an empty patch and invalid values", () => {
    expect(zoneUpdateSchema.safeParse({}).success).toBe(false);
    expect(failedFields(zoneUpdateSchema.safeParse({ quantity: -1 }))).toEqual(["quantity"]);
    expect(failedFields(zoneUpdateSchema.safeParse({ unit: "sq m" }))).toEqual(["unit"]);
  });
});

describe("project schemas", () => {
  it("needs code, client and building to create a project", () => {
    expect(failedFields(projectCreateSchema.safeParse({}))).toEqual(["code", "client", "building"]);
    expect(projectCreateSchema.parse({ code: " ORTAM-1 ", client: "C", building: "B" }).code).toBe("ORTAM-1");
  });

  it("stores a blank reviewer as null (pending)", () => {
    expect(projectUpdateSchema.parse({ reviewedBy: " " })).toEqual({ reviewedBy: null });
    expect(projectUpdateSchema.parse({ reviewedBy: "J. Doe" })).toEqual({ reviewedBy: "J. Doe" });
  });

  it("accepts ISO calendar dates or null only", () => {
    expect(projectUpdateSchema.parse({ inspectionDate: "2026-10-01" })).toEqual({ inspectionDate: "2026-10-01" });
    expect(projectUpdateSchema.parse({ reportDate: null })).toEqual({ reportDate: null });
    expect(failedFields(projectUpdateSchema.safeParse({ inspectionDate: "01/10/2026" }))).toEqual(["inspectionDate"]);
    expect(failedFields(projectUpdateSchema.safeParse({ reportDate: "2026-02-30" }))).toEqual(["reportDate"]);
  });

  it("does not allow changing the currency", () => {
    expect(projectUpdateSchema.safeParse({ currency: "USD" }).success).toBe(false);
  });
});

describe("splitSampleIds", () => {
  it("splits the separators used in the field notes and normalizes", () => {
    expect(splitSampleIds("S03|S07")).toEqual(["S03", "S07"]);
    expect(splitSampleIds(" s01, s02 ;S03  ")).toEqual(["S01", "S02", "S03"]);
    expect(splitSampleIds("   ")).toEqual([]);
  });
});
