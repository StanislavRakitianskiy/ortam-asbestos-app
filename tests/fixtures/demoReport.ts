import { draftSlots, type StoredNarrative } from "@/domain/narrative";
import { buildReportModel, type ReportInput, type ReportModel } from "@/domain/reportModel";
import { demoAnalysis, demoReportDocuments, demoReportProject } from "./demoProject";
import { goodDemoDraft } from "./demoNarrative";

/** The report model of the supplied demo data, with the hand-written narrative draft stored as an AI draft. */
export function demoReportModel(overrides: Partial<ReportInput> = {}): ReportModel {
  const base: ReportInput = {
    project: demoReportProject(),
    analysis: demoAnalysis(),
    labDocuments: demoReportDocuments(),
    narrative: [],
    corrections: [],
    checklist: null,
  };
  const zones = buildReportModel(base).findings;
  const narrative: StoredNarrative[] = draftSlots(zones, goodDemoDraft()).map((slot) => ({ ...slot, aiText: slot.text, source: "AI_DRAFT" }));
  return buildReportModel({ ...base, narrative, ...overrides });
}
