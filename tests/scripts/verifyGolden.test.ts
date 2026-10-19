import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toTemplateData } from "@/domain/templateData";
import { renderDocx } from "@/server/report/renderDocx";
import {
  checkPrinted,
  compareTotals,
  compareZones,
  costText,
  docxText,
  GoldenParseError,
  parseCents,
  parseGolden,
  printedFacts,
} from "../../scripts/verify-golden";
import { demoAnalysis, demoZones, withZone } from "../fixtures/demoProject";
import { demoReportModel } from "../fixtures/demoReport";

const claudeMd = readFileSync("CLAUDE.md", "utf8");
const golden = parseGolden(claudeMd);

/** CLAUDE.md with one line of the golden section replaced. */
const editGolden = (from: string, to: string) => {
  expect(claudeMd).toContain(from);
  return claudeMd.replace(from, to);
};

describe("parseGolden on CLAUDE.md", () => {
  it("reads every zone row", () => {
    expect(golden.zones.map((zone) => [zone.materialId, zone.status, zone.category, costText(zone.cost)])).toEqual([
      ["M01", "DETECTED", "A", "3,840.00"],
      ["M02", "DETECTED", "A", "7,200.00"],
      ["M03", "DETECTED", "A", "12,600.00"],
      ["M04", "NOT_DETECTED", "D", "no cost line"],
      ["M05", "DETECTED", "B", "Not priced (quantity unknown)"],
      ["M06", "INCONCLUSIVE", "C", "Not priced (unresolved)"],
      ["M07", "INACCESSIBLE", "C", "Not priced (unresolved)"],
    ]);
  });

  it("reads the totals line, not the brief example below it", () => {
    expect(golden.totals).toEqual({
      zoneSubtotal: 2_364_000,
      removalSubtotal: 1_533_000,
      replacementSubtotal: 831_000,
      direct: 2_734_000,
      contingency: 546_800,
      total: 3_280_800,
    });
  });

  it("refuses a section it cannot read instead of passing", () => {
    expect(() => parseGolden("# Nothing here")).toThrow(GoldenParseError);
    expect(() => parseGolden(editGolden("| M04 | NOT_DETECTED | D |", "| M04 | NEGATIVE | D |"))).toThrow(/unknown status "NEGATIVE"/);
    expect(() => parseGolden(editGolden("| M07 | INACCESSIBLE | C |", "| M07 | INACCESSIBLE | E |"))).toThrow(/unknown category "E"/);
    expect(() => parseGolden(editGolden("| no cost line |", "| free |"))).toThrow(/cost of M04/);
    expect(() => parseGolden(editGolden("Zone subtotal 23640.00", "Subtotal 23640.00"))).toThrow(/Zone subtotal/);
  });

  it("parses amounts in integer cents", () => {
    expect(parseCents("3840.00")).toBe(384_000);
    expect(parseCents("32,808.00")).toBe(3_280_800);
    expect(() => parseCents("3840")).toThrow(GoldenParseError);
  });
});

describe("compareZones and compareTotals", () => {
  it("find nothing wrong with the supplied demo data", () => {
    const model = demoReportModel();
    expect(compareZones(golden.zones, model).flatMap((check) => check.problems)).toEqual([]);
    expect(compareTotals(golden.totals, model.costScenario.summary).every((check) => check.ok)).toBe(true);
  });

  it("report a zone whose cost or category changed", () => {
    // Measuring M05 prices it: its cost and every total change.
    const model = demoReportModel({ analysis: demoAnalysis({ zones: withZone(demoZones(), "M05", { quantity: 10 }) }) });
    const m05 = compareZones(golden.zones, model).find((check) => check.materialId === "M05");
    expect(m05?.problems).toEqual(["cost 1,500.00, expected Not priced (quantity unknown)"]);
    expect(compareTotals(golden.totals, model.costScenario.summary).filter((check) => !check.ok).map((check) => check.key)).toEqual([
      "removalSubtotal",
      "replacementSubtotal",
      "zoneSubtotal",
      "direct",
      "contingency",
      "total",
    ]);
  });

  it("report a zone charged twice and zones missing on either side", () => {
    const model = demoReportModel();
    const m03 = model.costScenario.lines.find((line) => line.materialId === "M03")!;
    const doubled = { ...model, costScenario: { ...model.costScenario, lines: [...model.costScenario.lines, m03] } };
    expect(compareZones(golden.zones, doubled).find((check) => check.materialId === "M03")?.problems).toEqual([
      "2 cost lines; a zone is charged once",
    ]);

    const fewer = { ...model, findings: model.findings.filter((finding) => finding.materialId !== "M07") };
    expect(compareZones(golden.zones, fewer).find((check) => check.materialId === "M07")?.problems).toEqual(["missing from the project"]);
    expect(compareZones(golden.zones.slice(0, 6), model).find((check) => check.materialId === "M07")?.problems).toEqual([
      "not in the golden table",
    ]);
  });
});

describe("printed facts of a report file", () => {
  const template = new Uint8Array(readFileSync("templates/report_template.docx"));
  const meta = { revisionNumber: 4, generatedAt: "2026-10-19T14:32:05.000Z", snapshotHash: "ab12cd34ef56".padEnd(64, "0") };
  const text = docxText(renderDocx(template, toTemplateData(demoReportModel(), meta)));
  const expected = { total: "32,808.00", revision: 4, snapshot: "ab12cd34ef56" };

  it("finds every total, the revision and the snapshot in the Word file", () => {
    const facts = printedFacts(text);
    expect(facts.totals.length).toBeGreaterThanOrEqual(2);
    expect(new Set(facts.totals)).toEqual(new Set(["32,808.00"]));
    expect(facts).toMatchObject({ revision: 4, snapshot: "ab12cd34ef56" });
    expect(checkPrinted("Word file", facts, expected)).toEqual([]);
  });

  it("reads a total wrapped onto the next line, as PDF text does", () => {
    expect(printedFacts("illustrative total before tax CAD\n32,808.00, before tax").totals).toEqual(["32,808.00"]);
  });

  it("reports a missing, different or inconsistent total and another revision", () => {
    expect(checkPrinted("PDF file", { totals: [], revision: 4, snapshot: "ab12cd34ef56" }, expected)).toEqual([
      'PDF file: no "total before tax" amount found.',
    ]);
    expect(checkPrinted("PDF file", { totals: ["32,808.00", "5,280.00"], revision: 4, snapshot: "ab12cd34ef56" }, expected)).toEqual([
      "PDF file: prints different totals: 32,808.00, 5,280.00.",
    ]);
    expect(checkPrinted("PDF file", { totals: ["5,280.00"], revision: 3, snapshot: null }, expected)).toEqual([
      "PDF file: total 5,280.00, the revision snapshot says 32,808.00.",
      "PDF file: prints revision 3, expected 4.",
      "PDF file: prints snapshot none, expected ab12cd34ef56.",
    ]);
  });
});
