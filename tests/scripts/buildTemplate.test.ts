import { readFileSync } from "node:fs";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { REPORT_STATUS } from "@/domain/reportText";
import { MASTER_PATH, TEMPLATE_PATH, TemplateBuildError, buildDocumentXml, buildTemplate } from "../../scripts/build-template";

const master = new Uint8Array(readFileSync(MASTER_PATH));
const masterZip = new PizZip(master);
const masterXml = masterZip.file("word/document.xml")!.asText();

/** Every [bracketed placeholder] of the master, as listed in its document text. */
const MASTER_PLACEHOLDERS = [
  "[Project ID]", "[Client]", "[Building]", "[Address]", "[Inspection date]", "[Report date]", "[Prepared by]",
  "[Reviewed by or pending]", "[Accessible areas]", "[Planned disturbance]", "[Material ID]", "[Floor]", "[Room]",
  "[Description]", "[Condition]", "[Quantity and unit]", "[Planned work]", "[Report ID]", "[Source location]",
  "[Sample ID]", "[Layer]", "[Result label]", "[Type if reported]", "[Percentage if reported]",
  "[Detected / not detected / inconclusive / unsampled]", "[Exercise category A B C or D]", "[Reason]",
  "[Missing information]", "[Required follow up]", "[ID]", "[Value + unit]", "[CAD rate]", "[CAD]", "[Unmeasured ID]",
  "[Sum of quantity times both rates]", "[Zone subtotal plus allowances]", "[Direct subtotal times 0.20]",
  "[Direct subtotal plus contingency]", "[Sample matching checked]", "[Layers checked]", "[Quantities checked]",
  "[Costs checked]", "[Narrative checked]", "[Reviewer and date]",
];

const texts = (xml: string) => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]);

describe("build-template", () => {
  const built = buildDocumentXml(masterXml);

  it("covers every placeholder of the master and leaves none behind", () => {
    const masterText = texts(masterXml).join(" ");
    for (const placeholder of MASTER_PLACEHOLDERS) expect(masterText).toContain(placeholder);
    // Also the long instruction placeholders ([Summarize …], [Explain why …] …).
    expect(texts(built).filter((text) => /\[[^\]]+\]/.test(text))).toEqual([]);
  });

  it("replaces the master's fixed allowances and instructions with tags", () => {
    const text = texts(built).join("\n");
    expect(text).not.toMatch(/^2500\.00$|^1200\.00$/m);
    expect(text).toContain("{mobilization}");
    expect(text).toContain("{assessment}");
    expect(text).not.toContain("Use this structure");
    expect(text).not.toContain("Repeat this record");
    expect(text).toContain("Report {projectCode} | Revision {revisionNumber} | Generated {generatedAt} | Snapshot {snapshotShort}");
  });

  it("keeps the master's status wording, which the report model uses too", () => {
    expect(texts(built)).toContain(REPORT_STATUS);
  });

  it("fails and names the placeholder when the master does not contain it", () => {
    const withoutRoom = masterXml.replace("[Material ID] [Floor] [Room] [Description]", "[Material ID] [Floor] [Description]");
    expect(() => buildDocumentXml(withoutRoom)).toThrow(TemplateBuildError);
    expect(() => buildDocumentXml(withoutRoom)).toThrow(/\[Room\]/);
    expect(() => buildDocumentXml(masterXml.replace(">2500.00<", ">2600.00<"))).toThrow(/2500\.00/);
  });

  it("changes only word/document.xml: styles, fonts, numbering and theme stay as in the master", () => {
    const template = new PizZip(buildTemplate(master));
    const names = Object.keys(masterZip.files).filter((name) => !masterZip.files[name].dir);
    expect(Object.keys(template.files).filter((name) => !template.files[name].dir).sort()).toEqual([...names].sort());
    // Buffer.equals, not toEqual: a deep compare of every byte of the fonts and media took seconds under coverage.
    for (const name of names.filter((entry) => entry !== "word/document.xml")) {
      expect(Buffer.from(template.file(name)!.asUint8Array()).equals(Buffer.from(masterZip.file(name)!.asUint8Array())), name).toBe(true);
    }
  });

  it("is a valid docxtemplater template", () => {
    expect(() => new Docxtemplater(new PizZip(buildTemplate(master)), { paragraphLoop: true, linebreaks: true })).not.toThrow();
  });

  it("matches the committed templates/report_template.docx", () => {
    const committed = new PizZip(readFileSync(TEMPLATE_PATH)).file("word/document.xml")!.asText();
    expect(committed, "run npm run template:build").toBe(built);
  });
});
