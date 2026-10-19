import { describe, expect, it } from "vitest";
import { normalizeSampleId } from "@/domain/sampleId";

describe("normalizeSampleId", () => {
  it("trims surrounding whitespace and uppercases", () => {
    expect(normalizeSampleId(" s07 ")).toBe("S07");
    expect(normalizeSampleId("\tS02\n")).toBe("S02");
  });

  it("changes nothing else: no zero padding, no separator or inner-space removal", () => {
    expect(normalizeSampleId("S7")).toBe("S7");
    expect(normalizeSampleId("S-07")).toBe("S-07");
    expect(normalizeSampleId("S 07")).toBe("S 07");
    expect(normalizeSampleId("SO7")).toBe("SO7");
  });
});
