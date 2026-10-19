import { describe, expect, it } from "vitest";
import { looseSampleKey, similarRegisteredIds } from "@/domain/similarIds";

describe("similarRegisteredIds (text hint only, never a match)", () => {
  const register = ["S01", "S02", "S03", "S04", "S05", "S06", "S07"];

  it('suggests S07 for the lab ID "S7"', () => {
    expect(similarRegisteredIds("S7", register)).toEqual(["S07"]);
  });

  it("ignores separators, spaces and case", () => {
    expect(similarRegisteredIds(" s-07 ", register)).toEqual(["S07"]);
    expect(similarRegisteredIds("S 007", register)).toEqual(["S07"]);
  });

  it("does not suggest IDs that only share digits or a prefix", () => {
    expect(similarRegisteredIds("S08", register)).toEqual([]);
    expect(similarRegisteredIds("S70", register)).toEqual([]);
    expect(similarRegisteredIds("X07", register)).toEqual([]);
  });

  it("does not suggest the same ID (that one is matched exactly)", () => {
    expect(similarRegisteredIds("s07", register)).toEqual([]);
  });

  it("lists each similar ID once", () => {
    expect(similarRegisteredIds("S7", ["S07", "S007", "S07"])).toEqual(["S07", "S007"]);
  });

  it("keeps zero as a number", () => {
    expect(looseSampleKey("S00")).toBe("S0");
    expect(looseSampleKey("--")).toBe("");
    expect(similarRegisteredIds("--", register)).toEqual([]);
  });
});
