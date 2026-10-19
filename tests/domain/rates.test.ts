import { describe, expect, it } from "vitest";
import {
  CONTINGENCY,
  CONTINGENCY_PERCENT,
  FIXED_EXCLUSIONS,
  MOBILIZATION,
  PROFESSIONAL_ASSESSMENT,
  RATE_CARD,
  resolveRate,
} from "@/domain/rates";

describe("rate card", () => {
  it("matches fictional_rates_and_rules.pdf in integer cents", () => {
    expect(
      Object.values(RATE_CARD).map((rate) => [rate.ref, rate.unit, rate.removalRate, rate.replacementRate]),
    ).toEqual([
      ["R_PIPE", "linear_m", 12_000, 4_000],
      ["R_FLOOR", "m2", 4_500, 3_500],
      ["R_CEILING", "m2", 6_000, 3_000],
      ["R_PANEL", "m2", 8_500, 6_500],
    ]);
    for (const rate of Object.values(RATE_CARD)) {
      expect(Number.isInteger(rate.removalRate) && Number.isInteger(rate.replacementRate)).toBe(true);
    }
  });

  it("has the fixed allowances, contingency and the seven exclusions verbatim", () => {
    expect(MOBILIZATION).toBe(250_000);
    expect(PROFESSIONAL_ASSESSMENT).toBe(120_000);
    expect(CONTINGENCY_PERCENT).toBe(20);
    expect(CONTINGENCY).toBe(0.2);
    expect(FIXED_EXCLUSIONS).toEqual([
      "taxes",
      "unmeasured materials",
      "unresolved materials",
      "hidden materials",
      "business interruption",
      "engineering design",
      "permit costs",
    ]);
  });
});

describe("resolveRate", () => {
  it("returns the rate only when its unit equals the zone unit", () => {
    expect(resolveRate("R_PIPE", "linear_m")).toEqual({ ok: true, rate: RATE_CARD.R_PIPE });
    expect(resolveRate(" R_FLOOR ", "m2")).toEqual({ ok: true, rate: RATE_CARD.R_FLOOR });
    expect(resolveRate("R_PIPE", "m2")).toEqual({ ok: false, reason: "RATE_UNIT_MISMATCH", rate: RATE_CARD.R_PIPE });
  });

  it("reports a missing or unknown reference without falling back to another rate", () => {
    expect(resolveRate(null, "m2")).toEqual({ ok: false, reason: "NO_RATE_REF" });
    expect(resolveRate("  ", "m2")).toEqual({ ok: false, reason: "NO_RATE_REF" });
    expect(resolveRate("R_WALL", "m2")).toEqual({ ok: false, reason: "UNKNOWN_RATE_REF", rateRef: "R_WALL" });
    expect(resolveRate("r_pipe", "linear_m")).toEqual({ ok: false, reason: "UNKNOWN_RATE_REF", rateRef: "r_pipe" });
    expect(resolveRate("toString", "m2")).toEqual({ ok: false, reason: "UNKNOWN_RATE_REF", rateRef: "toString" });
  });
});
