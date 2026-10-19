import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toTemplateData } from "@/domain/templateData";
import { renderDocx, TemplateRenderError } from "@/server/report/renderDocx";
import { demoReportModel } from "../../fixtures/demoReport";
import { docxText } from "../../helpers/docxText";

const template = new Uint8Array(readFileSync("templates/report_template.docx"));
const meta = { revisionNumber: 3, generatedAt: "2026-10-19T14:32:05.000Z", snapshotHash: "ab12cd34ef56".padEnd(64, "0") };

describe("renderDocx on the demo report", () => {
  const data = toTemplateData(demoReportModel(), meta);
  const text = docxText(renderDocx(template, data));

  it("prints the golden totals and the unpriced zones", () => {
    for (const amount of ["15,330.00", "8,310.00", "23,640.00", "2,500.00", "1,200.00", "27,340.00", "5,468.00", "32,808.00"]) {
      expect(text).toContain(amount);
    }
    expect(text).toContain("Not priced");
    expect(text).toContain("Not priced (quantity unknown)");
  });

  it("keeps both S02 layers and their sources", () => {
    expect(text).toContain("S02");
    expect(text).toContain("Black adhesive");
    expect(text).toMatch(/LAB-A · LAB-A_fictional_lab_report\.pdf, page 1 · S02 · Black adhesive/);
  });

  it("prints the revision line", () => {
    expect(text).toContain("Report ORTAM-DEMO-001 | Revision 3 | Generated 2026-10-19 14:32 UTC | Snapshot ab12cd34ef56");
  });

  it("leaves no tag, placeholder or undefined value behind", () => {
    expect(text).not.toMatch(/undefined|null|\{|\}|\[[^\]]+\]/);
  });
});

describe("renderDocx with missing values", () => {
  it("names the tag whose value is missing instead of printing undefined", () => {
    const data = toTemplateData(demoReportModel(), meta);
    const broken = { ...data, infoDates: undefined } as unknown as typeof data;
    expect(() => renderDocx(template, broken)).toThrow(TemplateRenderError);
    expect(() => renderDocx(template, broken)).toThrow(/\{infoDates\}/);
  });

  it("also for a value inside a loop", () => {
    const data = toTemplateData(demoReportModel(), meta);
    const [first, ...rest] = data.zones;
    const broken = { ...data, zones: [{ ...first, zoneLocation: null }, ...rest] } as unknown as typeof data;
    expect(() => renderDocx(template, broken)).toThrow(/\{zoneLocation\}/);
  });
});
