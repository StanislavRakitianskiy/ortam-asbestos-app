import { describe, expect, it } from "vitest";
import { labRowIssues, type LabDocumentState, type RowEvidence } from "@/domain/labRowIssues";
import { demoResults, demoZones } from "../fixtures/demoProject";

const accepted = (id: string, fileName: string, labReportId: string): LabDocumentState => ({
  id,
  fileName,
  labReportId,
  status: "ACCEPTED",
  pendingRows: 0,
});

const verified = (labResultId: string): RowEvidence => ({ labResultId, evidenceVerified: true, confidence: "HIGH", flags: [] });

describe("labRowIssues", () => {
  const results = demoResults();
  const s01 = results[0];
  const documents = [accepted("doc-lab-a", "LAB-A_fictional_lab_report.pdf", "LAB-A")];

  it("raises nothing when every report is reviewed and every accepted row is verified", () => {
    expect(labRowIssues(demoZones(), documents, results, results.map((row) => verified(row.id)))).toEqual([]);
  });

  it("blocks on a lab report that is not fully reviewed, for every unfinished status", () => {
    const states: LabDocumentState[] = [
      { id: "d1", fileName: "LAB-B.pdf", labReportId: "LAB-B", status: "NEEDS_REVIEW", pendingRows: 2 },
      { id: "d2", fileName: "LAB-C.pdf", labReportId: null, status: "EXTRACTING", pendingRows: 0 },
      { id: "d3", fileName: "LAB-D.pdf", labReportId: null, status: "FAILED", pendingRows: 0 },
      { id: "d4", fileName: "LAB-E.pdf", labReportId: null, status: "NEEDS_REVIEW", pendingRows: 0 },
    ];
    const found = labRowIssues(demoZones(), [...documents, ...states], [], []);
    expect(found.map((item) => [item.key, item.severity, item.refs.documentIds])).toEqual([
      ["LAB_REPORT_NOT_REVIEWED:d1", "blocking", ["d1"]],
      ["LAB_REPORT_NOT_REVIEWED:d2", "blocking", ["d2"]],
      ["LAB_REPORT_NOT_REVIEWED:d3", "blocking", ["d3"]],
      ["LAB_REPORT_NOT_REVIEWED:d4", "blocking", ["d4"]],
    ]);
    expect(found[0].message).toBe(
      "LAB-B.pdf (LAB-B) has 2 rows pending review. None of its results are used until every row is accepted or rejected.",
    );
    expect(found[1].message).toContain("still being extracted");
    expect(found[2].message).toContain("failed");
    expect(found[3].message).toContain("has no result rows");
  });

  it("blocks on an accepted row whose quote was not found on the cited page, linked to its zone and row", () => {
    const [found] = labRowIssues(demoZones(), documents, [s01], [{ ...verified(s01.id), evidenceVerified: false }]);
    expect(found).toMatchObject({
      key: `EVIDENCE_NOT_VERIFIED:${s01.id}`,
      type: "EVIDENCE_NOT_VERIFIED",
      severity: "blocking",
      refs: { zoneIds: ["zone-m01"], sampleIds: ["S01"], labResultIds: [s01.id], documentIds: ["doc-lab-a"] },
    });
    expect(found.message).toContain('Lab row S01 "Insulation" (LAB-A, page 1) was accepted, but its quoted line was not found');
  });

  it("blocks on an accepted row with an open verification check and quotes the check", () => {
    const flags = [{ code: "LABEL_CONTRADICTS_LINE", message: "The cited line says Not detected." }];
    const [found] = labRowIssues(demoZones(), documents, [s01], [{ ...verified(s01.id), flags }]);
    expect(found.severity).toBe("blocking");
    expect(found.message).toBe(
      'Lab row S01 "Insulation" (LAB-A, page 1) was accepted with open evidence checks. The cited line says Not detected. Check it against the PDF and correct or reject the row, or resolve or flag this issue.',
    );
  });

  it("lists low AI confidence on a verified row as a warning", () => {
    const [found] = labRowIssues(demoZones(), documents, [s01], [{ ...verified(s01.id), confidence: "LOW" }]);
    expect(found).toMatchObject({ type: "LOW_CONFIDENCE", severity: "warning", key: `LOW_CONFIDENCE:${s01.id}` });
  });

  it("refers a row of an unregistered sample to no zone", () => {
    const row = { ...s01, id: "row-s99", sampleId: "S99" };
    const [found] = labRowIssues(demoZones(), documents, [row], [{ ...verified(row.id), evidenceVerified: false }]);
    expect(found.refs.zoneIds).toEqual([]);
  });
});
