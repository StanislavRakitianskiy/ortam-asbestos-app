import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/domain/canonicalJson";
import { buildReportModel } from "@/domain/reportModel";
import { NARRATIVE_MISSING_TEXT, REPORT_RENDERER_VERSION, missingNarrative, toTemplateData, type TemplateData } from "@/domain/templateData";
import { byMaterial, demoAnalysis, demoReportProject, demoZones } from "../fixtures/demoProject";
import { demoReportModel } from "../fixtures/demoReport";

const meta = { revisionNumber: 3, generatedAt: "2026-10-19T14:32:05.000Z", snapshotHash: "ab12cd34ef56".padEnd(64, "0") };

/**
 * toTemplateData output for the demo report, per REPORT_RENDERER_VERSION. When this test fails because the output
 * changed on purpose, raise REPORT_RENDERER_VERSION (so earlier revisions show as outdated) and add the new hash.
 */
const RENDERER_GOLDEN: Record<number, string> = {
  1: "52cede1ea9c3202bcca6943987793aa982fbc69828dba50700282a3515abf6dd",
};

/** A sparse project: one zone awaiting its lab result, one inaccessible zone, no lab reports, no narrative. */
function sparseModel() {
  const zones = demoZones().filter((zone) => zone.materialId === "M05" || zone.materialId === "M07");
  return buildReportModel({
    project: { ...demoReportProject(), client: "", address: "" },
    analysis: demoAnalysis({ zones, results: [], documents: [] }),
    labDocuments: [],
    narrative: [],
    corrections: [],
    checklist: null,
  });
}

/** Every value, recursively: nothing may be null or undefined. */
function leaves(value: unknown, path = "data"): [string, unknown][] {
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, `${path}[${index}]`));
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => leaves(item, `${path}.${key}`));
  return [[path, value]];
}

type Part = { value: string; loop: boolean; subparsed: Part[] };

/**
 * The tags of the template, nested by their loops: {#list} / {^flag} … {/list}. Every tag of the template sits whole in
 * one <w:t> (scripts/build-template.ts writes them so), and docxtemplater's InspectModule needs lodash, which is not a
 * dependency.
 */
function templateTags(): Part[] {
  const xml = new PizZip(readFileSync("templates/report_template.docx")).file("word/document.xml")!.asText();
  const text = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join("");
  const root: Part[] = [];
  const stack: { name: string; parts: Part[] }[] = [{ name: "", parts: root }];
  for (const [, prefix, name] of text.matchAll(/\{([#^/]?)([A-Za-z]+)\}/g)) {
    const level = stack[stack.length - 1];
    if (prefix === "/") {
      if (level.name !== name) throw new Error(`{/${name}} closes {#${level.name}}`);
      stack.pop();
    } else if (prefix === "#" || prefix === "^") {
      const part: Part = { value: name, loop: true, subparsed: [] };
      level.parts.push(part);
      stack.push({ name, parts: part.subparsed });
    } else {
      level.parts.push({ value: name, loop: false, subparsed: [] });
    }
  }
  if (stack.length !== 1) throw new Error(`{#${stack[stack.length - 1].name}} is never closed`);
  return root;
}

/**
 * Checks that every tag of the template is an own key of the object at its loop level. docxtemplater would look a
 * missing key up in the outer levels and print a wrong value without any error.
 */
function checkLevels(parts: readonly Part[], scope: Record<string, unknown>, path: string, problems: string[]) {
  for (const part of parts) {
    if (!Object.hasOwn(scope, part.value)) {
      problems.push(`${path}: {${part.loop ? "#" : ""}${part.value}} is not a key of this level`);
      continue;
    }
    const value = scope[part.value];
    if (!part.loop) {
      if (typeof value !== "string") problems.push(`${path}.${part.value} is ${typeof value}, not text`);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => checkLevels(part.subparsed, item as Record<string, unknown>, `${path}.${part.value}[${index}]`, problems));
    } else if (typeof value === "boolean") {
      checkLevels(part.subparsed, scope, path, problems);
    } else {
      problems.push(`${path}.${part.value} is ${typeof value}, not a list or a flag`);
    }
  }
}

describe("toTemplateData", () => {
  const demo = toTemplateData(demoReportModel(), meta);
  const sparse = toTemplateData(sparseModel(), meta);

  it("has a text for every value: nothing null or undefined", () => {
    for (const data of [demo, sparse]) {
      for (const [path, value] of leaves(data)) expect(["string", "boolean"], path).toContain(typeof value);
    }
  });

  it("has every template tag at its own loop level", () => {
    const tags = templateTags();
    for (const data of [demo, sparse]) {
      const problems: string[] = [];
      checkLevels(tags, data, "data", problems);
      expect(problems).toEqual([]);
    }
  });

  it("gives every table cell list at least one paragraph (an empty cell makes the .docx invalid)", () => {
    for (const data of [demo, sparse]) {
      for (const zone of data.zones) {
        for (const list of [zone.fieldLines, zone.layers, zone.interpretationLines, zone.actionLines, zone.uncertaintyLines]) {
          expect(list.length, zone.materialId).toBeGreaterThan(0);
        }
      }
      expect(data.costLines.length).toBeGreaterThan(0);
    }
  });

  it("keeps both S02 layers with their own result and source", () => {
    const m02 = demo.zones.find((zone) => zone.materialId === "M02")!;
    expect(m02.layers).toEqual([
      { layerEvidence: "LAB-A · LAB-A_fictional_lab_report.pdf, page 1 · S02 · Floor tile", layerResult: expect.stringMatching(/^Not detected/) },
      { layerEvidence: "LAB-A · LAB-A_fictional_lab_report.pdf, page 1 · S02 · Black adhesive", layerResult: "Detected · Chrysotile · 2%" },
    ]);
  });

  it("prints the cost lines and totals from the model, never computing them", () => {
    expect(demo.costLines.map((line) => [line.costZone.split(" ")[0], line.costQuantity, line.costTotal])).toEqual([
      ["M01", "24 linear_m", "3,840.00"],
      ["M02", "90 m2", "7,200.00"],
      ["M03", "140 m2", "12,600.00"],
      ["M05", "Unknown", "Not priced (quantity unknown)"],
    ]);
    expect(byMaterial(demo.costLines.map((line) => ({ ...line, materialId: line.costZone.split(" ")[0] })), "M05")).toMatchObject({
      costRemoval: "Not priced",
      costReplacement: "Not priced",
    });
    expect([demo.removalSubtotal, demo.replacementSubtotal, demo.zoneSubtotal, demo.direct, demo.contingency, demo.total]).toEqual([
      "15,330.00",
      "8,310.00",
      "23,640.00",
      "27,340.00",
      "5,468.00",
      "32,808.00",
    ]);
  });

  it("shows unknown quantity as unknown, never as 0", () => {
    const m07 = sparse.zones.find((zone) => zone.materialId === "M07")!;
    expect(m07.fieldLines).toContainEqual({ text: "Quantity: Unknown (not measured)" });
    expect(m07.layers).toEqual([{ layerEvidence: "No sample taken", layerResult: "Inaccessible and unsampled (unresolved)" }]);
    expect(JSON.stringify(sparse)).not.toMatch(/Quantity: 0\b/);
  });

  it("marks empty narrative instead of leaving gaps, and lists it", () => {
    expect(sparse.summaryParagraphs).toEqual([{ text: NARRATIVE_MISSING_TEXT }]);
    expect(missingNarrative(sparseModel())).toContain("Executive summary");
    expect(missingNarrative(demoReportModel())).toEqual([]);
  });

  it("prints the revision line values", () => {
    expect([demo.projectCode, demo.revisionNumber, demo.generatedAt, demo.snapshotShort]).toEqual(["ORTAM-DEMO-001", "3", "2026-10-19 14:32 UTC", "ab12cd34ef56"]);
  });

  it("has no rows and no tables for empty appendices", () => {
    expect([sparse.hasLabSources, sparse.hasCorrectionRows, sparse.hasDecisionRows, sparse.hasPlans]).toEqual([false, false, false, false]);
    expect(sparse.costLines).toEqual([expect.objectContaining({ costZone: "None", costTotal: "No detected zone to price" })]);
  });

  it(`matches the recorded output of renderer version ${REPORT_RENDERER_VERSION}`, () => {
    const hash = createHash("sha256").update(canonicalJson(demo satisfies TemplateData)).digest("hex");
    expect(hash, "toTemplateData output changed: raise REPORT_RENDERER_VERSION and record the new hash").toBe(RENDERER_GOLDEN[REPORT_RENDERER_VERSION]);
  });
});
