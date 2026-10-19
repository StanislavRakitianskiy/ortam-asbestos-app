import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { toTemplateData } from "@/domain/templateData";
import { convertDocxToPdf } from "@/server/report/gotenberg";
import { renderDocx } from "@/server/report/renderDocx";
import { demoReportModel } from "../../fixtures/demoReport";

/**
 * Converts the rendered demo report with the real Gotenberg from docker-compose.yml. Runs only with GOTENBERG_IT=1
 * (GOTENBERG_IT=1 npm test), so npm test itself does not need Docker.
 */
describe.skipIf(process.env.GOTENBERG_IT !== "1")("Gotenberg conversion (GOTENBERG_IT=1)", () => {
  it("converts the demo report to a multi-page PDF", async () => {
    const template = new Uint8Array(readFileSync("templates/report_template.docx"));
    const docx = renderDocx(template, toTemplateData(demoReportModel(), { revisionNumber: 1, generatedAt: new Date().toISOString(), snapshotHash: "0".repeat(64) }));
    const pdf = await convertDocxToPdf(docx, { baseUrl: process.env.GOTENBERG_URL ?? "http://localhost:3001" });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(5);
  }, 70_000);
});
