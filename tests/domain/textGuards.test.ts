import { describe, expect, it } from "vitest";
import { draftSlots, type NarrativeDraft, type NarrativeSection, type NarrativeSlotText, type StoredNarrative } from "@/domain/narrative";
import { buildReportModel, type ReportModel } from "@/domain/reportModel";
import { DISCLAIMERS } from "@/domain/reportText";
import { checkDraftStructure, checkNarrative, checkNarrativeBlocks, type GuardWarning } from "@/domain/textGuards";
import { demoAnalysis, demoReportDocuments, demoReportProject } from "../fixtures/demoProject";
import { goodDemoDraft } from "../fixtures/demoNarrative";

const model: ReportModel = buildReportModel({
  project: demoReportProject(),
  analysis: demoAnalysis(),
  labDocuments: demoReportDocuments(),
  narrative: [],
  corrections: [],
  checklist: null,
});
const zoneId = (materialId: string) => model.findings.find((finding) => finding.materialId === materialId)?.zoneId ?? "";

const goodSlots = () => draftSlots(model.findings, goodDemoDraft());

/** The good draft with one slot's text replaced. */
function withText(section: NarrativeSection, itemKey: string, text: string): NarrativeSlotText[] {
  return goodSlots().map((slot) => (slot.section === section && slot.itemKey === itemKey ? { ...slot, text } : slot));
}

const codes = (warnings: readonly GuardWarning[]) => warnings.map((warning) => warning.code);

describe("checkNarrativeBlocks", () => {
  it("finds nothing in a draft that follows every rule", () => {
    expect(checkNarrativeBlocks(model, goodSlots())).toEqual([]);
  });

  it("checks the model's stored narrative the same way", () => {
    const narrative: StoredNarrative[] = goodSlots().map((slot) => ({ ...slot, aiText: slot.text, source: "AI_DRAFT" }));
    const withNarrative = buildReportModel({
      project: demoReportProject(),
      analysis: demoAnalysis(),
      labDocuments: demoReportDocuments(),
      narrative,
      corrections: [],
      checklist: null,
    });
    expect(checkNarrative(withNarrative)).toEqual([]);
  });

  it("accepts the report's own disclaimers, including the negated 'free of asbestos'", () => {
    const text = Object.values(DISCLAIMERS).join(" ");
    expect(checkNarrativeBlocks(model, withText("limitations", "", text))).toEqual([]);
  });

  describe("FORBIDDEN_CLAIM", () => {
    it.each([
      ["asbestos-free", "After sampling, the building is asbestos-free."],
      ["asbestos free", "The G03 meeting room is asbestos free."],
      ["free of asbestos", "The building is free of asbestos."],
      ["free from asbestos", "The ground floor is free from asbestos."],
      ["no asbestos in the building", "There is no asbestos in the building."],
      ["no asbestos … in the building", "No asbestos was found in the building."],
      ["contains no asbestos", "The building contains no asbestos."],
      ["compliant", "The building is compliant with the regulations."],
      ["in compliance with", "The work is in compliance with the rules."],
      ["clearance granted", "Clearance granted for the B01 mechanical room."],
      ["clearance was issued", "Clearance was issued after the inspection."],
      ["cleared", "The G01 corridor is cleared for use."],
      ["safe to occupy", "The G02 office is safe to occupy."],
      ["safe for occupancy", "The building is safe for occupancy."],
      ["must be removed", "The pipe insulation must be removed."],
      ["should be removed", "The panel should be removed."],
      ["requires removal", "The ceiling requires removal."],
    ])("flags %s", (_name, sentence) => {
      const warnings = checkNarrativeBlocks(model, withText("limitations", "", sentence));
      expect(codes(warnings)).toEqual(["FORBIDDEN_CLAIM"]);
      expect(warnings[0]).toMatchObject({ section: "limitations", itemKey: "", excerpt: sentence });
    });

    it.each([
      "A negative sample does not establish that the building is free of asbestos.",
      "This result does not mean the building is asbestos-free.",
      "It cannot be concluded that there is no asbestos in the building.",
    ])("accepts the negated absence claim: %s", (sentence) => {
      expect(checkNarrativeBlocks(model, withText("limitations", "", sentence))).toEqual([]);
    });

    it("does not accept a negation that comes after the claim", () => {
      const warnings = checkNarrativeBlocks(model, withText("limitations", "", "The building is free of asbestos, not only the sampled plaster."));
      expect(codes(warnings)).toEqual(["FORBIDDEN_CLAIM"]);
    });

    it("never accepts a negated safety or removal claim as a safe phrasing", () => {
      expect(codes(checkNarrativeBlocks(model, withText("limitations", "", "The riser is not cleared.")))).toEqual(["FORBIDDEN_CLAIM"]);
    });
  });

  describe("UNSUPPORTED_NUMBER and MONEY_IN_NARRATIVE", () => {
    it("flags numbers that are not in the report facts", () => {
      const warnings = checkNarrativeBlocks(model, withText("zoneUncertainty", zoneId("M05"), "The panel may cover about 35 m2; M05 has not been measured."));
      expect(codes(warnings)).toEqual(["UNSUPPORTED_NUMBER"]);
      expect(warnings[0].message).toBe("Numbers not found in the report facts: 35.");
    });

    it("flags a date the facts do not contain", () => {
      const warnings = checkNarrativeBlocks(model, withText("limitations", "", "The inspection took place on 2026-09-30."));
      expect(codes(warnings)).toEqual(["UNSUPPORTED_NUMBER"]);
    });

    it("accepts quantities, lab percentages, pages and counts from the facts", () => {
      const text = "M03 in the G02 office covers 140 m2 and was sampled twice (S03 and S07, 1% each, page 1). The project has 7 zones.";
      expect(checkNarrativeBlocks(model, withText("zoneUncertainty", zoneId("M03"), text))).toEqual([]);
    });

    it("does not read identifiers with digits as numbers", () => {
      const text = "M01 in the B01 mechanical room: sample S01 (LAB-A, page 1) of project ORTAM-DEMO-001.";
      expect(checkNarrativeBlocks(model, withText("zoneUncertainty", zoneId("M01"), text))).toEqual([]);
    });

    it("flags money once, not again as an unsupported number", () => {
      const warnings = checkNarrativeBlocks(model, withText("zoneReason", zoneId("M03"), "M03 is category A; its line costs CAD 12,600.00."));
      expect(codes(warnings)).toEqual(["MONEY_IN_NARRATIVE"]);
      expect(warnings[0].message).toContain("CAD 12,600.00");
    });

    it.each(["The scenario totals $32,808.", "The total is 32,808.00 before tax.", "It would cost a few thousand dollars."])("flags money: %s", (sentence) => {
      expect(codes(checkNarrativeBlocks(model, withText("limitations", "", sentence)))).toEqual(["MONEY_IN_NARRATIVE"]);
    });
  });

  describe("UNKNOWN_REFERENCE", () => {
    it("flags a sample or zone ID that the project does not have", () => {
      const warnings = checkNarrativeBlocks(model, withText("limitations", "", "Sample S08 from M09 was not received."));
      expect(codes(warnings)).toEqual(["UNKNOWN_REFERENCE"]);
      expect(warnings[0].message).toBe("Refers to S08, M09, which are not a sample, zone, location or lab report of this project.");
    });
  });

  describe("ZONE_REFERENCE_INCOMPLETE", () => {
    it("flags a zone record without its location or one of its samples", () => {
      const slots = goodSlots().map((slot) =>
        slot.itemKey === zoneId("M03") && slot.section !== "recommendation"
          ? { ...slot, text: slot.text.replaceAll("S07", "the second sample").replaceAll("G02 office", "office") }
          : slot,
      );
      const warnings = checkNarrativeBlocks(model, slots);
      expect(warnings).toEqual([
        {
          code: "ZONE_REFERENCE_INCOMPLETE",
          section: null,
          itemKey: zoneId("M03"),
          message: 'The M03 findings texts do not mention the location "G02 office" and sample S07.',
          excerpt: null,
        },
      ]);
    });

    it("flags a recommendation without its material ID", () => {
      const warnings = checkNarrativeBlocks(model, withText("recommendation", zoneId("M05"), "Cement panel, E01 east elevation (S05): professional management review."));
      expect(warnings).toEqual([expect.objectContaining({ code: "ZONE_REFERENCE_INCOMPLETE", section: "recommendation", message: "The M05 recommendation does not mention the material ID M05." })]);
    });

    it("flags a summary that names a zone without its location and samples", () => {
      const warnings = checkNarrativeBlocks(model, withText("limitations", "", "M06 remains unresolved."));
      expect(warnings).toEqual([
        expect.objectContaining({ code: "ZONE_REFERENCE_INCOMPLETE", section: "limitations", message: 'Additional limitations mentions M06 without the location "B02 service room" and sample S06.' }),
      ]);
    });
  });

  describe("CATEGORY_MISMATCH", () => {
    it("flags a zone text that names another category", () => {
      const warnings = checkNarrativeBlocks(model, withText("zoneReason", zoneId("M05"), "M05 is category A because asbestos was detected."));
      expect(warnings).toEqual([expect.objectContaining({ code: "CATEGORY_MISMATCH", message: "Names category A, but M05 is category B (Professional management review)." })]);
    });

    it("flags a zone text that uses another category's wording", () => {
      const warnings = checkNarrativeBlocks(
        model,
        withText("recommendation", zoneId("M01"), "M01, B01 mechanical room (S01): professional management review."),
      );
      expect(codes(warnings)).toEqual(["CATEGORY_MISMATCH"]);
    });
  });

  describe("SAMPLED_SCOPE_MISSING", () => {
    it("flags a not detected zone whose texts do not limit the finding to the sampled material", () => {
      const slots = withText("zoneInterpretation", zoneId("M04"), "Asbestos was not detected in sample S04 of the wall plaster M04 in the G03 meeting room.");
      expect(checkNarrativeBlocks(model, slots)).toEqual([expect.objectContaining({ code: "SAMPLED_SCOPE_MISSING", section: null, itemKey: zoneId("M04") })]);
    });
  });

  it("does not check empty slots", () => {
    const slots = goodSlots().map((slot) => ({ ...slot, text: "" }));
    expect(checkNarrativeBlocks(model, slots)).toEqual([]);
  });
});

describe("checkDraftStructure", () => {
  const draft = () => goodDemoDraft();

  it("accepts a draft with every zone once and the computed categories", () => {
    expect(checkDraftStructure(model, draft())).toEqual([]);
  });

  it("rejects a zone that is not in the register", () => {
    const changed: NarrativeDraft = { ...draft(), perZone: [...draft().perZone, { ...draft().perZone[0], materialId: "M09" }] };
    expect(checkDraftStructure(model, changed)).toEqual([
      'perZone names material ID "M09", which is not in the register. Use only these material IDs: M01, M02, M03, M04, M05, M06, M07.',
    ]);
  });

  it("rejects a missing or duplicated zone", () => {
    const perZone = draft().perZone.filter((item) => item.materialId !== "M04");
    perZone.push({ ...perZone[0] });
    expect(checkDraftStructure(model, { ...draft(), perZone })).toEqual([
      "perZone lists M01 more than once. Write exactly one entry per material zone.",
      "perZone is missing M04. Write exactly one entry for every material zone.",
    ]);
  });

  it("rejects a recommendation whose category differs from the computed one", () => {
    const recommendations = draft().recommendations.map((item) => (item.materialId === "M05" ? { ...item, category: "A" as const } : item));
    expect(checkDraftStructure(model, { ...draft(), recommendations })).toEqual([
      "recommendations M05: category must be B exactly as given; the application sets categories, never the narrative.",
    ]);
  });

  it("matches material IDs after trimming and uppercasing", () => {
    const perZone = draft().perZone.map((item) => ({ ...item, materialId: ` ${item.materialId.toLowerCase()} ` }));
    expect(checkDraftStructure(model, { ...draft(), perZone })).toEqual([]);
  });

  it("rejects an empty executive summary", () => {
    expect(checkDraftStructure(model, { ...draft(), executiveSummary: [" "] })).toEqual(["executiveSummary must contain at least one paragraph."]);
  });
});
