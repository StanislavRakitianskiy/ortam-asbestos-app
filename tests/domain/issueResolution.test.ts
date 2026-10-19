import { describe, expect, it } from "vitest";
import {
  applyResolutions,
  flaggedLimitations,
  issueResolutionInputSchema,
  readiness,
  refsKey,
  type StoredResolution,
} from "@/domain/issueResolution";
import { issue, type ReviewIssue } from "@/domain/matching";

const unmatched = issue("UNMATCHED_LAB_SAMPLE", ["S7"], "blocking", "Lab sample S7 does not match.", {
  sampleIds: ["S7"],
  labResultIds: ["row-s7"],
  documentIds: ["doc-x"],
});
const conflict = issue("CONFLICTING_RESULT", ["S04", "plaster"], "blocking", "S04 plaster conflicts.", {
  zoneIds: ["zone-m04"],
  sampleIds: ["S04"],
  labResultIds: ["row-b-s04", "row-x-s04"],
  documentIds: ["doc-b", "doc-x"],
});
const inconclusive = issue("INCONCLUSIVE_RESULT", ["zone-m06", "S06", "insulation fragment"], "warning", "S06 is inconclusive.", {
  zoneIds: ["zone-m06"],
});

function decision(found: ReviewIssue, decided: "RESOLVED" | "FLAGGED", note = "Checked"): StoredResolution {
  return {
    issueKey: found.key,
    issueType: found.type,
    issueMessage: found.message,
    refsKey: refsKey(found.refs),
    decision: decided,
    note,
    decidedAt: "2026-10-19T12:00:00.000Z",
  };
}

describe("refsKey", () => {
  it("does not depend on the order or repetition of IDs", () => {
    const shuffled = { ...conflict.refs, labResultIds: ["row-x-s04", "row-b-s04", "row-x-s04"], documentIds: ["doc-x", "doc-b"] };
    expect(refsKey(shuffled)).toBe(refsKey(conflict.refs));
  });

  it("changes when the issue refers to another lab row", () => {
    expect(refsKey({ ...conflict.refs, labResultIds: [...conflict.refs.labResultIds, "row-y-s04"] })).not.toBe(refsKey(conflict.refs));
  });
});

describe("applyResolutions", () => {
  it("leaves undecided blocking issues open and warnings as information", () => {
    const { issues, autoCleared } = applyResolutions([unmatched, inconclusive], []);
    expect(issues.map((found) => [found.key, found.state])).toEqual([
      [unmatched.key, "OPEN"],
      [inconclusive.key, "INFO"],
    ]);
    expect(autoCleared).toEqual([]);
  });

  it("applies a decision by the stable issue key", () => {
    const { issues } = applyResolutions([unmatched, conflict], [decision(unmatched, "RESOLVED"), decision(conflict, "FLAGGED", "Lab asked to re-test")]);
    expect(issues.map((found) => [found.key, found.state, found.decision?.note])).toEqual([
      [unmatched.key, "RESOLVED", "Checked"],
      [conflict.key, "FLAGGED", "Lab asked to re-test"],
    ]);
  });

  it("reopens an issue whose evidence changed after the decision, keeping the old decision for display", () => {
    const stored = decision(conflict, "RESOLVED");
    const changed = { ...conflict, refs: { ...conflict.refs, labResultIds: [...conflict.refs.labResultIds, "row-y-s04"] } };
    const [found] = applyResolutions([changed], [stored]).issues;
    expect(found.state).toBe("OPEN");
    expect(found.decision).toBeNull();
    expect(found.outdatedDecision).toEqual({ decision: "RESOLVED", note: "Checked", decidedAt: stored.decidedAt });
  });

  it("auto-clears a decision whose issue has gone, with the snapshot of the issue", () => {
    const { issues, autoCleared } = applyResolutions([conflict], [decision(unmatched, "RESOLVED", "Typo of S07")]);
    expect(issues).toHaveLength(1);
    expect(autoCleared).toEqual([
      {
        issueKey: unmatched.key,
        issueType: "UNMATCHED_LAB_SAMPLE",
        issueMessage: unmatched.message,
        decision: "RESOLVED",
        note: "Typo of S07",
        decidedAt: "2026-10-19T12:00:00.000Z",
      },
    ]);
  });

  it("auto-clears a decision whose issue became a warning (it needs no decision any more)", () => {
    const rate = issue("RATE_UNIT_MISMATCH", ["zone-m01", "R_PIPE"], "blocking", "Unit mismatch.", { zoneIds: ["zone-m01"] });
    const stored = decision(rate, "FLAGGED");
    const { issues, autoCleared } = applyResolutions([{ ...rate, severity: "warning" }], [stored]);
    expect(issues[0].state).toBe("INFO");
    expect(autoCleared.map((cleared) => cleared.issueKey)).toEqual([rate.key]);
  });
});

describe("readiness", () => {
  it("is blocked while a blocking issue is open", () => {
    const { issues } = applyResolutions([unmatched, conflict, inconclusive], [decision(conflict, "FLAGGED")]);
    expect(readiness(issues)).toEqual({ status: "BLOCKED", label: "Blocked: 1 open item", open: 1, flagged: 1, canGenerate: false });
  });

  it("allows a draft with flagged items", () => {
    const { issues } = applyResolutions([unmatched, conflict], [decision(unmatched, "FLAGGED"), decision(conflict, "FLAGGED")]);
    expect(readiness(issues)).toEqual({ status: "DRAFT_WITH_FLAGS", label: "Draft with 2 flagged items", open: 0, flagged: 2, canGenerate: true });
  });

  it("is ready when every blocking issue is resolved; warnings never block", () => {
    const { issues } = applyResolutions([unmatched, inconclusive], [decision(unmatched, "RESOLVED")]);
    expect(readiness(issues)).toEqual({ status: "READY", label: "Ready to generate", open: 0, flagged: 0, canGenerate: true });
  });

  it("counts several open items", () => {
    expect(readiness(applyResolutions([unmatched, conflict], []).issues).label).toBe("Blocked: 2 open items");
  });
});

describe("flaggedLimitations", () => {
  it("lists flagged issues with the employee's note for the report's scope limitations", () => {
    const { issues } = applyResolutions([unmatched, conflict], [decision(unmatched, "RESOLVED"), decision(conflict, "FLAGGED", "Re-test requested")]);
    expect(flaggedLimitations(issues)).toEqual([
      { issueKey: conflict.key, type: "CONFLICTING_RESULT", message: conflict.message, note: "Re-test requested" },
    ]);
  });
});

describe("issueResolutionInputSchema", () => {
  it("requires a note", () => {
    const result = issueResolutionInputSchema.safeParse({ issueKey: unmatched.key, decision: "RESOLVED", note: "   " });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["note"], message: "Enter a note." });
  });

  it("accepts only the two decisions and trims the note", () => {
    expect(issueResolutionInputSchema.safeParse({ issueKey: "K", decision: "IGNORED", note: "x" }).success).toBe(false);
    expect(issueResolutionInputSchema.parse({ issueKey: " K ", decision: "FLAGGED", note: " Re-test " })).toEqual({
      issueKey: "K",
      decision: "FLAGGED",
      note: "Re-test",
    });
  });

  it("rejects unknown fields", () => {
    expect(issueResolutionInputSchema.safeParse({ issueKey: "K", decision: "FLAGGED", note: "x", zoneId: "z" }).success).toBe(false);
  });
});
