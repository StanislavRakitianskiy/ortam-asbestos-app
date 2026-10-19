import { describe, expect, it } from "vitest";
import { documentReviewOutcome, isBulkAcceptable, reviewProgress, type BulkCandidate } from "@/domain/labReview";

const clean: BulkCandidate = { reviewStatus: "PENDING", evidenceVerified: true, confidence: "HIGH", flags: [] };

describe("isBulkAcceptable", () => {
  it("takes a pending row with verified evidence, confidence above low and no open check", () => {
    expect(isBulkAcceptable(clean)).toBe(true);
    expect(isBulkAcceptable({ ...clean, confidence: "MEDIUM" })).toBe(true);
    // A row the employee added has no AI confidence; its quote still has to be verified.
    expect(isBulkAcceptable({ ...clean, confidence: null })).toBe(true);
  });

  it("leaves everything else for a look at the source", () => {
    expect(isBulkAcceptable({ ...clean, evidenceVerified: false })).toBe(false);
    expect(isBulkAcceptable({ ...clean, confidence: "LOW" })).toBe(false);
    expect(isBulkAcceptable({ ...clean, flags: [{ code: "LABEL_CONTRADICTS_LINE" }] })).toBe(false);
    expect(isBulkAcceptable({ ...clean, reviewStatus: "REJECTED" })).toBe(false);
    expect(isBulkAcceptable({ ...clean, reviewStatus: "ACCEPTED" })).toBe(false);
  });
});

describe("review progress and document outcome", () => {
  const rows = (...statuses: BulkCandidate["reviewStatus"][]) => statuses.map((reviewStatus) => ({ reviewStatus }));

  it("counts accepted and rejected rows as reviewed: 7 of 8", () => {
    const progress = reviewProgress(rows("ACCEPTED", "ACCEPTED", "ACCEPTED", "ACCEPTED", "ACCEPTED", "ACCEPTED", "REJECTED", "PENDING"));
    expect(progress).toEqual({ total: 8, reviewed: 7, pending: 1, accepted: 6, rejected: 1 });
  });

  it("accepts a document only when it has rows and none is pending", () => {
    expect(documentReviewOutcome(rows("ACCEPTED", "REJECTED"))).toBe("ACCEPTED");
    expect(documentReviewOutcome(rows("REJECTED"))).toBe("ACCEPTED");
    expect(documentReviewOutcome(rows("ACCEPTED", "PENDING"))).toBe("NEEDS_REVIEW");
    expect(documentReviewOutcome([])).toBe("NEEDS_REVIEW");
  });
});
