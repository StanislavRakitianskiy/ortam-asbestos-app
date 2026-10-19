import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "@/domain/canonicalJson";
import type { ReportModel } from "@/domain/reportModel";
import { REPORT_RENDERER_VERSION } from "@/domain/templateData";
import { ReportStepError } from "@/server/errors";
import { sha256Hex } from "@/server/storage/uploads";

/**
 * What a report revision is rendered from: the report model, the template it is filled into and the version of the code
 * that turns the model into template values. Its canonical JSON is stored in ReportRevision.snapshotJson and its SHA-256
 * is the snapshot hash. The revision number and the generation time are printed in the document but are not part of the
 * snapshot, so regenerating unchanged data gives the same hash.
 */
export type ReportSnapshot = { model: ReportModel; templateSha256: string; rendererVersion: number };

export const REPORT_TEMPLATE_PATH = path.join(process.cwd(), "templates", "report_template.docx");

export type ReportTemplate = { bytes: Uint8Array; sha256: string };

/** The Word template built by `npm run template:build` (committed to the repository). */
export async function loadReportTemplate(templatePath: string = REPORT_TEMPLATE_PATH): Promise<ReportTemplate> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(templatePath));
  } catch {
    throw new ReportStepError(
      `The report template ${path.relative(process.cwd(), templatePath)} is missing or unreadable. Run npm run template:build.`,
      "TEMPLATE_MISSING",
    );
  }
  return { bytes, sha256: sha256Hex(bytes) };
}

export function buildSnapshot(
  model: ReportModel,
  templateSha256: string,
  rendererVersion: number = REPORT_RENDERER_VERSION,
): { json: string; hash: string } {
  const json = canonicalJson({ model, templateSha256, rendererVersion } satisfies ReportSnapshot);
  return { json, hash: sha256Hex(new TextEncoder().encode(json)) };
}

/** The stored snapshot. Only JSON written by buildSnapshot is ever stored, so a shape check is enough. */
export function parseSnapshot(json: string): ReportSnapshot {
  const value = JSON.parse(json) as Partial<ReportSnapshot> | null;
  if (value === null || typeof value !== "object" || typeof value.templateSha256 !== "string" || typeof value.model !== "object" || value.model === null) {
    throw new ReportStepError("The stored report snapshot is not readable.", "SNAPSHOT_INVALID");
  }
  return value as ReportSnapshot;
}
