import { z } from "zod";
import type { Category } from "./types";

/**
 * The report prose the AI drafts and the employee edits. Each text lives in one slot (section + itemKey) of
 * ReportNarrative: the AI draft as generated (aiText) and the current text are kept apart. Numbers, categories and
 * costs never come from these texts; they are built in code.
 */

export const NARRATIVE_SECTIONS = [
  "executiveSummary",
  "zoneInterpretation",
  "zoneReason",
  "zoneUncertainty",
  "zoneFollowUp",
  "recommendation",
  "limitations",
] as const;
export type NarrativeSection = (typeof NARRATIVE_SECTIONS)[number];

/** Sections with one slot per material zone; their itemKey is the zone's database ID. */
export const ZONE_SECTIONS = ["zoneInterpretation", "zoneReason", "zoneUncertainty", "zoneFollowUp", "recommendation"] as const;
export type ZoneSection = (typeof ZONE_SECTIONS)[number];

export const isZoneSection = (section: NarrativeSection): section is ZoneSection =>
  (ZONE_SECTIONS as readonly string[]).includes(section);

/** The four parts of a zone's findings record. */
export const ZONE_RECORD_SECTIONS = ["zoneInterpretation", "zoneReason", "zoneUncertainty", "zoneFollowUp"] as const;

export const NARRATIVE_LABELS: Record<NarrativeSection, string> = {
  executiveSummary: "Executive summary",
  zoneInterpretation: "Interpretation",
  zoneReason: "Reason for the review action",
  zoneUncertainty: "Uncertainty",
  zoneFollowUp: "Required follow-up",
  recommendation: "Recommendation",
  limitations: "Additional limitations",
};

export const NARRATIVE_SOURCES = ["AI_DRAFT", "EDITED"] as const;
export type NarrativeSource = (typeof NARRATIVE_SOURCES)[number];

/** A stored slot. */
export type StoredNarrative = {
  section: NarrativeSection;
  itemKey: string;
  /** The AI draft exactly as generated; null when the employee wrote the text without one. */
  aiText: string | null;
  text: string;
  source: NarrativeSource;
};

/** A slot as the report shows it. NONE: nothing drafted or written yet. */
export type NarrativeBlock = {
  section: NarrativeSection;
  itemKey: string;
  text: string;
  aiText: string | null;
  source: NarrativeSource | "NONE";
};

export const NARRATIVE_TEXT_MAX = 6000;

const sectionSchema = z.enum(NARRATIVE_SECTIONS, { error: "Choose a report section." });
const itemKeySchema = z.string().max(100, { error: "must be at most 100 characters" });

export const narrativeEditSchema = z.strictObject({
  section: sectionSchema,
  itemKey: itemKeySchema,
  text: z
    .string({ error: "Enter the text." })
    .max(NARRATIVE_TEXT_MAX, { error: `must be at most ${NARRATIVE_TEXT_MAX} characters` })
    .transform((value) => value.trim()),
});
export type NarrativeEditInput = z.input<typeof narrativeEditSchema>;

export const narrativeResetSchema = z.strictObject({ section: sectionSchema, itemKey: itemKeySchema });
export type NarrativeResetInput = z.input<typeof narrativeResetSchema>;

/** The AI draft as the narrative prompt returns it (src/server/ai/narrativeSchema.ts). */
export type NarrativeDraft = {
  executiveSummary: string[];
  perZone: { materialId: string; interpretation: string; reason: string; uncertainty: string; followUp: string }[];
  recommendations: { materialId: string; category: Category; text: string }[];
  limitations: string[];
};

export type NarrativeSlotText = { section: NarrativeSection; itemKey: string; text: string };

const normalizeId = (id: string) => id.trim().toUpperCase();

/** Paragraphs are separated by a blank line, list items by a line break. */
const paragraphs = (items: readonly string[]) => items.map((item) => item.trim()).filter((item) => item !== "").join("\n\n");
const lines = (items: readonly string[]) => items.map((item) => item.trim()).filter((item) => item !== "").join("\n");

/**
 * The slot texts of a structurally valid draft (see checkDraftStructure). Zone items are keyed by the zone ID of the
 * material ID they name; an item for an unknown material ID is skipped.
 */
export function draftSlots(zones: readonly { zoneId: string; materialId: string }[], draft: NarrativeDraft): NarrativeSlotText[] {
  const zoneIdByMaterial = new Map(zones.map((zone) => [normalizeId(zone.materialId), zone.zoneId]));
  const slots: NarrativeSlotText[] = [{ section: "executiveSummary", itemKey: "", text: paragraphs(draft.executiveSummary) }];
  for (const item of draft.perZone) {
    const zoneId = zoneIdByMaterial.get(normalizeId(item.materialId));
    if (zoneId === undefined) continue;
    slots.push(
      { section: "zoneInterpretation", itemKey: zoneId, text: item.interpretation.trim() },
      { section: "zoneReason", itemKey: zoneId, text: item.reason.trim() },
      { section: "zoneUncertainty", itemKey: zoneId, text: item.uncertainty.trim() },
      { section: "zoneFollowUp", itemKey: zoneId, text: item.followUp.trim() },
    );
  }
  for (const item of draft.recommendations) {
    const zoneId = zoneIdByMaterial.get(normalizeId(item.materialId));
    if (zoneId !== undefined) slots.push({ section: "recommendation", itemKey: zoneId, text: item.text.trim() });
  }
  slots.push({ section: "limitations", itemKey: "", text: lines(draft.limitations) });
  return slots;
}

/** The block of a slot, or an empty NONE block when the slot has never been written. */
export function narrativeBlock(stored: readonly StoredNarrative[], section: NarrativeSection, itemKey: string): NarrativeBlock {
  const found = stored.find((slot) => slot.section === section && slot.itemKey === itemKey);
  if (found === undefined) return { section, itemKey, text: "", aiText: null, source: "NONE" };
  return { section, itemKey, text: found.text, aiText: found.aiText, source: found.source };
}
