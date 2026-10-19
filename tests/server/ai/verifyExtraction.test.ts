import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeEvidence, parseExtraction, verifyExtraction, type ParsedExtraction } from "@/server/ai/verifyExtraction";
import { extractPages, type PageText } from "@/server/pdf/extractPages";
import { loadAiFixture } from "../../helpers/fakeAi";

const PROJECT = "ORTAM-DEMO-001";
const pagesOf: Record<string, PageText[]> = {};

beforeAll(async () => {
  for (const lab of ["A", "B", "C"]) {
    const bytes = new Uint8Array(await readFile(`fixtures/LAB-${lab}_fictional_lab_report.pdf`));
    pagesOf[lab] = (await extractPages(bytes)).pages;
  }
});

function parsed(output: unknown): ParsedExtraction {
  const outcome = parseExtraction(output);
  if (!outcome.ok) throw new Error(outcome.issues.join("; "));
  return outcome.value;
}

const fixtureOutput = (name: string) => structuredClone(loadAiFixture(name).output);
const verifyFixture = (name: string, lab = "A", projectCode = PROJECT) =>
  verifyExtraction(parsed(fixtureOutput(name)), { pages: pagesOf[lab], projectCode });
const codes = (flags: { code: string }[]) => flags.map((flag) => flag.code);
const row = (result: ReturnType<typeof verifyFixture>, sampleId: string, layer?: string) =>
  result.results.find((item) => item.sampleId === sampleId && (layer === undefined || item.layer === layer))!;

describe("verifyExtraction on recorded responses", () => {
  it("accepts the recorded LAB-A answer: every quote is on its page, both S02 layers are kept", () => {
    const result = verifyFixture("lab-a.recorded");
    expect(result.warnings).toEqual([]);
    expect(result.results.map((item) => [item.sampleId, item.layer, item.resultLabel])).toEqual([
      ["S01", "Insulation", "DETECTED"],
      ["S02", "Floor tile", "NOT_DETECTED"],
      ["S02", "Black adhesive", "DETECTED"],
      ["S03", "Textured coating", "DETECTED"],
    ]);
    for (const item of result.results) {
      expect(item.evidenceVerified, item.sampleId).toBe(true);
      expect(item.flags, item.sampleId).toEqual([]);
      expect(item.sourcePage).toBe(1);
    }
    expect(row(result, "S02", "Floor tile")).toMatchObject({ percentage: null, percentageRaw: "Not reported", asbestosType: null });
    expect(row(result, "S02", "Black adhesive")).toMatchObject({ percentage: 2, percentageRaw: "2%", asbestosType: "Chrysotile" });
    expect(result.notes.every((note) => note.verified)).toBe(true);
  });

  it("keeps each row exactly as the model returned it for aiJson", () => {
    const output = fixtureOutput("lab-a.recorded");
    const result = verifyExtraction(parsed(output), { pages: pagesOf.A, projectCode: PROJECT });
    expect(result.results.map((item) => JSON.parse(item.aiJson))).toEqual(output.results);
  });

  it("accepts the recorded LAB-B and LAB-C answers, including an inconclusive row and a note over two lines", () => {
    const labB = verifyFixture("lab-b.recorded", "B");
    expect(labB.warnings).toEqual([]);
    expect(labB.results.every((item) => item.evidenceVerified && item.flags.length === 0)).toBe(true);
    expect(row(labB, "S06")).toMatchObject({ resultLabel: "INCONCLUSIVE", percentage: null });
    expect(row(labB, "S06").labNote).toContain("insufficient usable material");
    // "S05 quantity is / not supplied by the lab." wraps onto a second line in the PDF.
    expect(labB.notes.some((note) => note.text.includes("S05 quantity is not supplied") && note.verified)).toBe(true);

    const labC = verifyFixture("lab-c.recorded", "C");
    expect(labC.warnings).toEqual([]);
    expect(labC.results).toHaveLength(1);
    expect(row(labC, "S07")).toMatchObject({ resultLabel: "DETECTED", evidenceVerified: true, flags: [] });
  });
});

describe("verifyExtraction on tampered responses", () => {
  it("flags a quote that is not in the PDF and lowers the confidence", () => {
    const result = verifyFixture("lab-a.tampered-fabricated-quote");
    const s01 = row(result, "S01");
    expect(s01.evidenceVerified).toBe(false);
    expect(s01.confidence).toBe("LOW");
    expect(codes(s01.flags)).toContain("EVIDENCE_NOT_FOUND");
    // The real S01 line is now cited by nothing.
    expect(codes(result.warnings)).toContain("LINE_NOT_EXTRACTED");
    // The other rows are unaffected.
    expect(row(result, "S03")).toMatchObject({ evidenceVerified: true, flags: [] });
  });

  it("flags a page that does not exist", () => {
    const s03 = row(verifyFixture("lab-a.tampered-wrong-page"), "S03");
    expect(s03.evidenceVerified).toBe(false);
    expect(s03.confidence).toBe("LOW");
    // The real S03 line on page 1 is then cited by nothing, which check (h) reports as well.
    expect(codes(s03.flags)).toEqual(["PAGE_OUT_OF_RANGE", "UNCITED_LINE_FOR_SAMPLE"]);
    expect(s03.flags[0].message).toContain("Page 2 does not exist");
  });

  it("catches merged S02 layers: the floor tile line is uncited and the merged layer is not in the cited line", () => {
    const result = verifyFixture("lab-a.tampered-merged-s02");
    const merged = row(result, "S02");
    expect(result.results.filter((item) => item.sampleId === "S02")).toHaveLength(1);
    expect(codes(merged.flags)).toEqual(expect.arrayContaining(["LAYER_NOT_IN_LINE", "UNCITED_LINE_FOR_SAMPLE"]));
    expect(merged.confidence).toBe("LOW");
    // Verification never changes the label; the employee decides.
    expect(merged.resultLabel).toBe("DETECTED");
    const uncited = result.warnings.filter((warning) => warning.code === "LINE_NOT_EXTRACTED");
    expect(uncited).toHaveLength(1);
    expect(uncited[0].message).toContain("S02 Floor tile Not detected");
  });
});

describe("verifyExtraction line checks", () => {
  it("flags a label that contradicts the printed result", () => {
    const output = fixtureOutput("lab-a.recorded");
    const tile = output.results.find((item) => item.layer === "Floor tile")!;
    tile.resultLabel = "DETECTED";
    const flags = codes(row(verifyExtraction(parsed(output), { pages: pagesOf.A, projectCode: PROJECT }), "S02", "Floor tile").flags);
    expect(flags).toEqual(expect.arrayContaining(["RESULT_NOT_IN_LINE", "LABEL_CONTRADICTS_LINE"]));
  });

  it("flags a sample ID that is not in the cited line", () => {
    const output = fixtureOutput("lab-a.recorded");
    output.results.find((item) => item.sampleId === "S01")!.sampleId = "S10";
    const result = verifyExtraction(parsed(output), { pages: pagesOf.A, projectCode: PROJECT });
    expect(codes(row(result, "S10").flags)).toContain("SAMPLE_ID_NOT_IN_LINE");
  });

  it("does not store a percentage outside 0–100 and flags it", () => {
    const output = fixtureOutput("lab-a.recorded");
    output.results.find((item) => item.sampleId === "S01")!.percentage = 150;
    const s01 = row(verifyExtraction(parsed(output), { pages: pagesOf.A, projectCode: PROJECT }), "S01");
    expect(s01.percentage).toBeNull();
    expect(codes(s01.flags)).toContain("PERCENTAGE_OUT_OF_RANGE");
    expect(JSON.parse(s01.aiJson).percentage).toBe(150);
  });

  it("flags the same sample and layer twice", () => {
    const output = fixtureOutput("lab-a.recorded");
    output.results.push(structuredClone(output.results[0]));
    const result = verifyExtraction(parsed(output), { pages: pagesOf.A, projectCode: PROJECT });
    const s01 = result.results.filter((item) => item.sampleId === "S01");
    expect(s01).toHaveLength(2);
    for (const item of s01) expect(codes(item.flags)).toContain("DUPLICATE_SAMPLE_LAYER");
  });

  it("does not accept a quote that matches several lines", () => {
    const output = fixtureOutput("lab-a.recorded");
    output.results.find((item) => item.sampleId === "S01")!.sourceText = "Chrysotile";
    const s01 = row(verifyExtraction(parsed(output), { pages: pagesOf.A, projectCode: PROJECT }), "S01");
    expect(s01.evidenceVerified).toBe(false);
    expect(codes(s01.flags)).toContain("EVIDENCE_AMBIGUOUS");
  });

  it("ignores only whitespace and typographic differences in quotes", () => {
    expect(normalizeEvidence("S02  Black adhesive   Detected")).toBe("S02 Black adhesive Detected");
    expect(normalizeEvidence("“Not–reported”")).toBe('"Not-reported"');
    const output = fixtureOutput("lab-a.recorded");
    output.results.find((item) => item.sampleId === "S01")!.sourceText = "S01 Insulation Detected Chrysotile 15%";
    expect(row(verifyExtraction(parsed(output), { pages: pagesOf.A, projectCode: PROJECT }), "S01").evidenceVerified).toBe(true);
  });

  it("flags a lab note that is not printed in the document", () => {
    const output = fixtureOutput("lab-a.recorded");
    output.results.find((item) => item.sampleId === "S01")!.labNote = "Sample was wet on arrival.";
    expect(codes(row(verifyExtraction(parsed(output), { pages: pagesOf.A, projectCode: PROJECT }), "S01").flags)).toContain(
      "LAB_NOTE_NOT_FOUND",
    );
  });
});

describe("verifyExtraction document checks", () => {
  it("warns when the report belongs to another project or names none", () => {
    expect(codes(verifyFixture("lab-a.recorded", "A", "ORTAM-OTHER-009").warnings)).toEqual(["PROJECT_REF_MISMATCH"]);
    expect(codes(verifyFixture("lab-a.recorded", "A", " ortam-demo-001 ").warnings)).toEqual([]);
    const output = fixtureOutput("lab-a.recorded");
    (output.report as { projectRef: string | null }).projectRef = null;
    expect(codes(verifyExtraction(parsed(output), { pages: pagesOf.A, projectCode: PROJECT }).warnings)).toEqual(["PROJECT_REF_MISSING"]);
  });

  it("warns when no lab report ID or no results were extracted", () => {
    const output = fixtureOutput("lab-a.recorded");
    (output.report as { labReportId: string | null }).labReportId = null;
    output.results = [];
    const warnings = codes(verifyExtraction(parsed(output), { pages: pagesOf.A, projectCode: PROJECT }).warnings);
    expect(warnings).toEqual(expect.arrayContaining(["NO_RESULTS", "LAB_REPORT_ID_MISSING", "LINE_NOT_EXTRACTED"]));
  });

  it("marks a note that is not on its page as unverified", () => {
    const output = fixtureOutput("lab-a.recorded");
    (output.documentNotes as { text: string }[])[0].text = "S02 was resampled.";
    const result = verifyExtraction(parsed(output), { pages: pagesOf.A, projectCode: PROJECT });
    expect(result.notes[0].verified).toBe(false);
    expect(codes(result.warnings)).toContain("NOTE_NOT_FOUND");
  });
});

describe("parseExtraction (check a)", () => {
  it("compares enum values ignoring case and stores confidence upper-case", () => {
    const output = fixtureOutput("lab-a.recorded");
    output.results[0].resultLabel = " detected ";
    output.results[0].confidence = "High";
    const value = parsed(output);
    expect(value.results[0].resultLabel).toBe("DETECTED");
    expect(value.results[0].confidence).toBe("HIGH");
  });

  it("rejects unknown labels, fractional pages and missing fields with readable issues", () => {
    const output = fixtureOutput("lab-a.recorded");
    output.results[0].resultLabel = "POSITIVE";
    output.results[1].sourcePage = 1.5;
    delete output.results[2].labNote;
    const outcome = parseExtraction(output);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues.some((issue) => issue.startsWith("results.0.resultLabel"))).toBe(true);
    expect(outcome.issues.some((issue) => issue.startsWith("results.1.sourcePage"))).toBe(true);
    expect(outcome.issues.some((issue) => issue.startsWith("results.2.labNote"))).toBe(true);
  });
});
