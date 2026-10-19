import { describe, expect, it } from "vitest";
import { buildReportModel } from "@/domain/reportModel";
import type { ReportModel } from "@/domain/reportModel";
import { buildSnapshot, parseSnapshot } from "@/server/report/snapshot";
import { demoAnalysis, demoReportDocuments, demoReportProject, demoZones, withZone } from "../../fixtures/demoProject";
import { demoReportModel } from "../../fixtures/demoReport";

const TEMPLATE = "a".repeat(64);

/** The same data with every object's keys in reverse order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversedKeys(item)]));
  }
  return value;
}

describe("report snapshot hash", () => {
  it("is the same for the same data, whatever order the keys were built in", () => {
    const model = demoReportModel();
    const first = buildSnapshot(model, TEMPLATE);
    expect(buildSnapshot(demoReportModel(), TEMPLATE).hash).toBe(first.hash);
    expect(buildSnapshot(reversedKeys(model) as ReportModel, TEMPLATE).hash).toBe(first.hash);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a zone quantity changes", () => {
    const changed = buildReportModel({
      project: demoReportProject(),
      analysis: demoAnalysis({ zones: withZone(demoZones(), "M05", { quantity: 12 }) }),
      labDocuments: demoReportDocuments(),
      narrative: [],
      corrections: [],
      checklist: null,
    });
    const unchanged = buildReportModel({
      project: demoReportProject(),
      analysis: demoAnalysis(),
      labDocuments: demoReportDocuments(),
      narrative: [],
      corrections: [],
      checklist: null,
    });
    expect(buildSnapshot(changed, TEMPLATE).hash).not.toBe(buildSnapshot(unchanged, TEMPLATE).hash);
  });

  it("changes with the template and with the renderer version, which change the files", () => {
    const model = demoReportModel();
    const base = buildSnapshot(model, TEMPLATE, 1).hash;
    expect(buildSnapshot(model, "b".repeat(64), 1).hash).not.toBe(base);
    expect(buildSnapshot(model, TEMPLATE, 2).hash).not.toBe(base);
  });

  it("does not contain the revision number or the generation time", () => {
    const { json } = buildSnapshot(demoReportModel(), TEMPLATE);
    expect(Object.keys(JSON.parse(json) as object).sort()).toEqual(["model", "rendererVersion", "templateSha256"]);
    expect(json).not.toMatch(/revisionNumber|generatedAt/);
  });

  it("is stored as JSON that gives back the same model", () => {
    const model = demoReportModel();
    expect(parseSnapshot(buildSnapshot(model, TEMPLATE).json).model).toEqual(model);
  });
});
