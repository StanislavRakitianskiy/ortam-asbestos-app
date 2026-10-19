import { describe, expect, it } from "vitest";
import { formatCad, formatQuantity, formatResultLabel } from "@/domain/format";

describe("formatCad", () => {
  it("formats integer cents en-CA with two decimals", () => {
    expect(formatCad(3_280_800)).toBe("32,808.00");
    expect(formatCad(70_000)).toBe("700.00");
    expect(formatCad(123_456_789)).toBe("1,234,567.89");
    expect(formatCad(5)).toBe("0.05");
    expect(formatCad(0)).toBe("0.00");
    expect(formatCad(-1_234)).toBe("-12.34");
  });

  it("refuses non-integer amounts", () => {
    expect(() => formatCad(12.5)).toThrow(RangeError);
    expect(() => formatCad(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatQuantity", () => {
  it("shows an unknown quantity as Unknown, never 0", () => {
    expect(formatQuantity(null, "m2")).toBe("Unknown");
    expect(formatQuantity(null, "linear_m")).toBe("Unknown");
  });

  it("keeps the unit exactly as supplied", () => {
    expect(formatQuantity(140, "m2")).toBe("140 m2");
    expect(formatQuantity(24, "linear_m")).toBe("24 linear_m");
    expect(formatQuantity(1250.5, "m2")).toBe("1,250.5 m2");
  });
});

describe("formatResultLabel", () => {
  it("turns labels into readable text", () => {
    expect(formatResultLabel("DETECTED")).toBe("Detected");
    expect(formatResultLabel("NOT_DETECTED")).toBe("Not detected");
    expect(formatResultLabel("INCONCLUSIVE")).toBe("Inconclusive");
  });
});
