import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/domain/canonicalJson";

describe("canonicalJson", () => {
  it("sorts object keys at every level and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: null } })).toBe('{"a":{"c":null,"d":[3,1,2]},"b":1}');
  });

  it("gives the same text whatever order the keys were added in", () => {
    const first = { zone: "M03", quantity: 140, samples: ["S03", "S07"], cost: { total: 1260000, priced: true } };
    const second = { cost: { priced: true, total: 1260000 }, samples: ["S03", "S07"], quantity: 140, zone: "M03" };
    expect(canonicalJson(first)).toBe(canonicalJson(second));
  });

  it("round-trips through JSON.parse", () => {
    const value = { text: 'Quote "S02" — Black adhesive\nline 2', quantity: null, flags: [true, false], nested: [{ z: 1, a: 2 }] };
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });

  it("rejects values JSON would silently drop or change", () => {
    expect(() => canonicalJson({ quantity: undefined })).toThrow(/\$\.quantity/);
    expect(() => canonicalJson({ amounts: [1, Number.NaN] })).toThrow(/\$\.amounts\[1\]/);
    expect(() => canonicalJson({ at: new Date(0) })).toThrow(/not a plain object/);
    expect(() => canonicalJson({ run: () => 1 })).toThrow(/function/);
  });
});
