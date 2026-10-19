import { describe, expect, it } from "vitest";
import { labResultCorrectionSchema, labResultDecisionSchema, manualLabResultSchema } from "@/domain/labReviewInput";

const issues = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));

describe("labResultCorrectionSchema", () => {
  it("requires a reason", () => {
    expect(issues(labResultCorrectionSchema.safeParse({ changes: { sampleId: "S07" } }))).toEqual({ reason: "Enter a short reason." });
    expect(issues(labResultCorrectionSchema.safeParse({ changes: { sampleId: "S07" }, reason: "   " }))).toEqual({
      reason: "Enter a short reason.",
    });
  });

  it("requires at least one change and rejects fields that are not editable", () => {
    expect(issues(labResultCorrectionSchema.safeParse({ changes: {}, reason: "typo" }))).toEqual({ changes: "Change at least one value." });
    expect(labResultCorrectionSchema.safeParse({ changes: { sourceText: "x" }, reason: "typo" }).success).toBe(false);
    expect(labResultCorrectionSchema.safeParse({ changes: { sourcePage: 2 }, reason: "typo" }).success).toBe(false);
  });

  it("trims values, stores blank text as null and keeps the sample ID as printed", () => {
    const parsed = labResultCorrectionSchema.parse({
      changes: { sampleId: " s07 ", asbestosType: "  ", labNote: " Note " },
      reason: " label reads S07 ",
    });
    expect(parsed).toEqual({ changes: { sampleId: "s07", asbestosType: null, labNote: "Note" }, reason: "label reads S07" });
  });

  it("rejects a percentage outside 0–100 and an ID that is really two", () => {
    expect(issues(labResultCorrectionSchema.safeParse({ changes: { percentage: 120 }, reason: "x" }))).toEqual({
      "changes.percentage": "must be from 0 to 100",
    });
    expect(labResultCorrectionSchema.safeParse({ changes: { percentage: null }, reason: "x" }).success).toBe(true);
    expect(issues(labResultCorrectionSchema.safeParse({ changes: { sampleId: "S03|S07" }, reason: "x" }))).toEqual({
      "changes.sampleId": "must be a single sample ID without spaces, commas or |",
    });
  });
});

describe("labResultDecisionSchema", () => {
  it("requires a reason to reject, and none to accept or reopen", () => {
    expect(issues(labResultDecisionSchema.safeParse({ decision: "REJECT" }))).toEqual({ reason: "Enter a short reason." });
    expect(labResultDecisionSchema.safeParse({ decision: "ACCEPT" }).success).toBe(true);
    expect(labResultDecisionSchema.safeParse({ decision: "REOPEN" }).success).toBe(true);
    expect(labResultDecisionSchema.safeParse({ decision: "DELETE" }).success).toBe(false);
  });
});

describe("manualLabResultSchema", () => {
  const row = {
    sampleId: "S02",
    layer: "Floor tile",
    resultLabel: "NOT_DETECTED",
    asbestosType: null,
    percentage: null,
    labNote: null,
    sourcePage: 1,
    sourceText: "S02  Floor tile  Not detected  Not reported  Not reported",
    reason: "AI merged the two S02 layers",
  };

  it("accepts a complete row", () => {
    expect(manualLabResultSchema.safeParse(row).success).toBe(true);
  });

  it("requires the page, the quoted line and a reason", () => {
    expect(Object.keys(issues(manualLabResultSchema.safeParse({ ...row, sourcePage: undefined, sourceText: " ", reason: "" })))).toEqual([
      "sourcePage",
      "sourceText",
      "reason",
    ]);
    expect(manualLabResultSchema.safeParse({ ...row, sourcePage: 0 }).success).toBe(false);
    expect(manualLabResultSchema.safeParse({ ...row, sourcePage: 1.5 }).success).toBe(false);
  });
});
