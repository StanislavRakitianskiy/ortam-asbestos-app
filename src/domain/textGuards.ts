import { CATEGORY_TITLES } from "./categories";
import { NARRATIVE_LABELS, ZONE_RECORD_SECTIONS, type NarrativeDraft, type NarrativeSection, type NarrativeSlotText } from "./narrative";
import { narrativeFacts, type NarrativeFacts } from "./narrativeFacts";
import type { ReportModel, ZoneFinding } from "./reportModel";
import { joinAnd } from "./reportText";
import { CATEGORIES } from "./types";

/**
 * Deterministic checks of the report prose, run on the AI draft and on every employee edit (D-034).
 *
 * - checkDraftStructure: problems that make an AI answer unusable (an unknown, missing or duplicated zone, a changed
 *   category). The draft is retried once and otherwise rejected; nothing of it is stored.
 * - checkNarrative / checkNarrativeBlocks: warnings shown beside the text. They never change or block the text: the
 *   employee decides. They are computed on every read, so they also follow data changes made after the draft.
 */

export const GUARD_CODES = [
  "ZONE_REFERENCE_INCOMPLETE",
  "UNKNOWN_REFERENCE",
  "CATEGORY_MISMATCH",
  "UNSUPPORTED_NUMBER",
  "MONEY_IN_NARRATIVE",
  "FORBIDDEN_CLAIM",
  "SAMPLED_SCOPE_MISSING",
] as const;
export type GuardCode = (typeof GUARD_CODES)[number];

export const GUARD_TITLES: Record<GuardCode, string> = {
  ZONE_REFERENCE_INCOMPLETE: "Zone reference incomplete",
  UNKNOWN_REFERENCE: "Unknown reference",
  CATEGORY_MISMATCH: "Category mismatch",
  UNSUPPORTED_NUMBER: "Number not in the report facts",
  MONEY_IN_NARRATIVE: "Amount in narrative",
  FORBIDDEN_CLAIM: "Claim the report must not make",
  SAMPLED_SCOPE_MISSING: "Sampled-material scope missing",
};

export type GuardWarning = {
  code: GuardCode;
  /** The block the warning is about; null for a whole zone record (its four findings texts together). */
  section: NarrativeSection | null;
  /** Zone ID for zone blocks and zone records, "" for section-level blocks. */
  itemKey: string;
  message: string;
  /** The sentence or value that triggered the warning. */
  excerpt: string | null;
};

// ---------------------------------------------------------------- draft structure

const normalizeId = (id: string) => id.trim().toUpperCase();
const isBlank = (text: string) => text.trim() === "";

/** Problems that make an AI draft unusable, worded for the retry request. Empty when the draft can be stored. */
export function checkDraftStructure(model: Pick<ReportModel, "findings">, draft: NarrativeDraft): string[] {
  const problems: string[] = [];
  const zones = new Map(model.findings.map((finding) => [normalizeId(finding.materialId), finding]));
  const expected = model.findings.map((finding) => finding.materialId).join(", ");

  if (draft.executiveSummary.every(isBlank)) problems.push("executiveSummary must contain at least one paragraph.");

  const checkItems = <T extends { materialId: string }>(list: string, items: readonly T[], checkItem: (item: T, zone: ZoneFinding) => void) => {
    const seen = new Set<string>();
    for (const item of items) {
      const id = normalizeId(item.materialId);
      const zone = zones.get(id);
      if (zone === undefined) {
        problems.push(`${list} names material ID "${item.materialId}", which is not in the register. Use only these material IDs: ${expected}.`);
        continue;
      }
      if (seen.has(id)) problems.push(`${list} lists ${zone.materialId} more than once. Write exactly one entry per material zone.`);
      seen.add(id);
      checkItem(item, zone);
    }
    const missing = model.findings.filter((finding) => !seen.has(normalizeId(finding.materialId))).map((finding) => finding.materialId);
    if (missing.length > 0) problems.push(`${list} is missing ${missing.join(", ")}. Write exactly one entry for every material zone.`);
  };

  checkItems("perZone", draft.perZone, (item, zone) => {
    if (isBlank(item.interpretation) || isBlank(item.reason)) {
      problems.push(`perZone ${zone.materialId}: interpretation and reason must not be empty.`);
    }
  });
  checkItems("recommendations", draft.recommendations, (item, zone) => {
    if (item.category !== zone.category) {
      problems.push(
        `recommendations ${zone.materialId}: category must be ${zone.category} exactly as given; the application sets categories, never the narrative.`,
      );
    }
    if (isBlank(item.text)) problems.push(`recommendations ${zone.materialId}: text must not be empty.`);
  });
  return problems;
}

// ---------------------------------------------------------------- text warnings

/** Identifiers (S03, B01, LAB-A, ORTAM-DEMO-001, R_PIPE) and numbers (140, 2%, 3,840.00, 2026-10-19). */
const TOKEN = /[A-Za-z0-9][A-Za-z0-9_]*(?:(?:[.\-]|,(?=\d{3}(?!\d)))[A-Za-z0-9_]+)*%?/g;
const ORDINAL = /^\d+(?:st|nd|rd|th)$/i;
/** A negation counts only within this many words before the claim, in the same sentence. */
const NEGATION_WINDOW = 12;
const NEGATION = /\b(?:not|no|never|cannot|without|nor|neither)\b|n['’]t\b/i;

/** Currency words and symbols, with an adjacent amount when there is one. */
const CURRENCY = /(?:\$|\b(?:CAD|USD)\b)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:CAD|USD|dollars?)\b|\$|\b(?:CAD|USD|dollars?)\b/gi;
/** An amount written like money: 3,840.00 or 700.00. */
const MONEY_AMOUNT = /\b\d{1,3}(?:,\d{3})*\.\d{2}\b(?!\s?%)/g;

type ClaimRule = { pattern: RegExp; negatable: boolean; message: string };

const ABSENCE = "Claims an absence of asbestos. A not detected result applies only to the sampled material.";
const CLEARANCE = "Claims clearance. No clearance evidence is supplied.";

/** Absence claims may appear negated ("does not establish that the building is free of asbestos"); the others never. */
const CLAIM_RULES: ClaimRule[] = [
  { pattern: /\basbestos[\s-]free\b/gi, negatable: true, message: ABSENCE },
  { pattern: /\bfree (?:of|from) asbestos\b/gi, negatable: true, message: ABSENCE },
  { pattern: /\bno asbestos (?:[a-z]+ ){0,3}in the (?:building|property|premises)\b/gi, negatable: true, message: ABSENCE },
  { pattern: /\b(?:building|property|premises) (?:contains|has) no asbestos\b/gi, negatable: true, message: ABSENCE },
  { pattern: /\b(?:non-)?compliant\b|\bin compliance with\b|\bcompl(?:ies|y) with\b/gi, negatable: false, message: "Claims compliance. The report must not claim legal compliance." },
  { pattern: /\bclearance (?:is |was |has been |can be )?(?:granted|issued|achieved|given|confirmed)\b/gi, negatable: false, message: CLEARANCE },
  { pattern: /\bcleared\b/gi, negatable: false, message: CLEARANCE },
  { pattern: /\bsafe (?:to|for) (?:occupy|occupancy|occupation|re-?entry)\b/gi, negatable: false, message: "Claims safety. The report must not claim safety." },
  {
    pattern: /\b(?:must|should|shall|needs? to|has to|have to) be removed\b|\brequires? removal\b/gi,
    negatable: false,
    message: "Prescribes removal. The exercise flags material for professional review; it does not prescribe removal.",
  },
];

type Range = { start: number; end: number };

/** Every string and number in the facts, for the known identifiers and numbers. */
function factValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number") out.push(String(value));
  else if (Array.isArray(value)) for (const item of value) factValues(item, out);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) factValues(item, out);
  return out;
}

const hasLetter = (token: string) => /[A-Za-z]/.test(token);
const hasDigit = (token: string) => /\d/.test(token);

/** "3,840.00" → "3840", "2%" → "2", "1.50" → "1.5". A date or range gives several numbers. */
function numberParts(token: string): string[] {
  return token
    .replace(/%$/, "")
    .split("-")
    .filter((part) => part !== "")
    .map((part) => {
      const value = Number(part.replace(/,/g, ""));
      return Number.isFinite(value) ? String(value) : part;
    });
}

type Vocabulary = { identifiers: Set<string>; numbers: Set<string> };

function vocabulary(facts: NarrativeFacts): Vocabulary {
  const identifiers = new Set<string>();
  const numbers = new Set<string>();
  for (const text of factValues(facts)) {
    for (const match of text.matchAll(TOKEN)) {
      const token = match[0];
      if (!hasDigit(token)) continue;
      if (hasLetter(token) && !ORDINAL.test(token)) identifiers.add(token.toUpperCase());
      else for (const part of numberParts(token.replace(/(?:st|nd|rd|th)$/i, ""))) numbers.add(part);
    }
  }
  return { identifiers, numbers };
}

/** The sentence around a position, for the excerpt. */
function sentenceAt(text: string, index: number): string {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? "), before.lastIndexOf("\n"));
  const afterMatch = text.slice(index).search(/[.!?](?:\s|$)|\n/);
  const end = afterMatch === -1 ? text.length : index + afterMatch + 1;
  const sentence = text.slice(start === -1 ? 0 : start + 1, end).trim();
  return sentence.length > 240 ? `${sentence.slice(0, 237)}…` : sentence;
}

const inRanges = (ranges: readonly Range[], index: number) => ranges.some((range) => index >= range.start && index < range.end);

function mentionsId(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i").test(text);
}

const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** What a text that mentions this zone fails to name: material ID, location and every sample ID (prompt rule). */
function missingReferences(text: string, zone: ZoneFinding, requireMaterialId: boolean): string[] {
  const missing: string[] = [];
  if (requireMaterialId && !mentionsId(text, zone.materialId)) missing.push(`the material ID ${zone.materialId}`);
  if (zone.location.trim() !== "" && !normalizeText(text).includes(normalizeText(zone.location))) {
    missing.push(`the location "${zone.location.trim()}"`);
  }
  const samples = zone.samples.map((sample) => sample.sampleId).filter((sampleId) => !mentionsId(text, sampleId));
  if (samples.length > 0) missing.push(`sample${samples.length === 1 ? "" : "s"} ${joinAnd(samples)}`);
  return missing;
}

function blockWarnings(slot: NarrativeSlotText, words: Vocabulary, zone: ZoneFinding | null): GuardWarning[] {
  const { text } = slot;
  if (isBlank(text)) return [];
  const warnings: GuardWarning[] = [];
  const warn = (code: GuardCode, message: string, excerpt: string | null) =>
    warnings.push({ code, section: slot.section, itemKey: slot.itemKey, message, excerpt });

  // Money first, so an amount is reported once as money and not again as an unsupported number.
  const moneyRanges: Range[] = [];
  const amounts: string[] = [];
  for (const pattern of [CURRENCY, MONEY_AMOUNT]) {
    for (const match of text.matchAll(pattern)) {
      if (inRanges(moneyRanges, match.index)) continue;
      moneyRanges.push({ start: match.index, end: match.index + match[0].length });
      amounts.push(match[0].trim());
    }
  }
  if (amounts.length > 0) {
    warn("MONEY_IN_NARRATIVE", `Mentions money (${amounts.join(", ")}). Amounts are computed in code and shown in the cost scenario only.`, sentenceAt(text, moneyRanges[0].start));
  }

  const unsupported: string[] = [];
  const unknown: string[] = [];
  let firstUnsupported: number | null = null;
  let firstUnknown: number | null = null;
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    if (!hasDigit(token) || inRanges(moneyRanges, match.index)) continue;
    if (hasLetter(token) && !ORDINAL.test(token)) {
      if (!words.identifiers.has(token.toUpperCase()) && !unknown.includes(token)) {
        unknown.push(token);
        firstUnknown ??= match.index;
      }
      continue;
    }
    const parts = numberParts(token.replace(/(?:st|nd|rd|th)$/i, ""));
    if (parts.some((part) => !words.numbers.has(part)) && !unsupported.includes(token)) {
      unsupported.push(token);
      firstUnsupported ??= match.index;
    }
  }
  if (unsupported.length > 0) {
    warn("UNSUPPORTED_NUMBER", `Numbers not found in the report facts: ${unsupported.join(", ")}.`, sentenceAt(text, firstUnsupported ?? 0));
  }
  if (unknown.length > 0) {
    warn(
      "UNKNOWN_REFERENCE",
      `Refers to ${unknown.join(", ")}, which ${unknown.length === 1 ? "is" : "are"} not a sample, zone, location or lab report of this project.`,
      sentenceAt(text, firstUnknown ?? 0),
    );
  }

  for (const rule of CLAIM_RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const sentence = sentenceAt(text, match.index);
      if (rule.negatable) {
        const before = sentence.slice(0, Math.max(0, sentence.toLowerCase().indexOf(match[0].toLowerCase())));
        if (NEGATION.test(before.split(/\s+/).slice(-NEGATION_WINDOW).join(" "))) continue;
      }
      warn("FORBIDDEN_CLAIM", `"${match[0]}": ${rule.message}`, sentence);
    }
  }

  if (zone !== null) {
    for (const match of text.matchAll(/\bcategory\s+([A-D])\b/gi)) {
      const named = match[1].toUpperCase();
      if (named !== zone.category) {
        warn("CATEGORY_MISMATCH", `Names category ${named}, but ${zone.materialId} is category ${zone.category} (${zone.categoryTitle}).`, sentenceAt(text, match.index));
      }
    }
    for (const category of CATEGORIES) {
      if (category === zone.category) continue;
      const index = text.toLowerCase().indexOf(CATEGORY_TITLES[category].toLowerCase());
      if (index !== -1) {
        warn(
          "CATEGORY_MISMATCH",
          `Uses the wording of category ${category} ("${CATEGORY_TITLES[category]}"), but ${zone.materialId} is category ${zone.category} (${zone.categoryTitle}).`,
          sentenceAt(text, index),
        );
      }
    }
  }
  return warnings;
}

/** The narrative slots of a model, in report order. */
export function modelSlots(model: ReportModel): NarrativeSlotText[] {
  const slots: NarrativeSlotText[] = [{ section: "executiveSummary", itemKey: "", text: model.executiveSummary.narrative.text }];
  for (const finding of model.findings) {
    slots.push(
      { section: "zoneInterpretation", itemKey: finding.zoneId, text: finding.narrative.interpretation.text },
      { section: "zoneReason", itemKey: finding.zoneId, text: finding.narrative.reason.text },
      { section: "zoneUncertainty", itemKey: finding.zoneId, text: finding.narrative.uncertainty.text },
      { section: "zoneFollowUp", itemKey: finding.zoneId, text: finding.narrative.followUp.text },
    );
    const recommendation = model.recommendations.find((item) => item.zoneId === finding.zoneId);
    slots.push({ section: "recommendation", itemKey: finding.zoneId, text: recommendation?.narrative.text ?? "" });
  }
  slots.push({ section: "limitations", itemKey: "", text: model.scopeLimitations.narrative.text });
  return slots;
}

/** Warnings for the given texts against the model's facts, in report order. */
export function checkNarrativeBlocks(model: ReportModel, slots: readonly NarrativeSlotText[]): GuardWarning[] {
  const words = vocabulary(narrativeFacts(model));
  const zonesById = new Map(model.findings.map((finding) => [finding.zoneId, finding]));
  const textOf = (section: NarrativeSection, itemKey: string) =>
    slots.find((slot) => slot.section === section && slot.itemKey === itemKey)?.text ?? "";
  const warnings: GuardWarning[] = [];

  const sectionLevel = (section: "executiveSummary" | "limitations") => {
    const slot = { section, itemKey: "", text: textOf(section, "") };
    warnings.push(...blockWarnings(slot, words, null));
    // Every zone a summary text mentions is named with its location and sample IDs.
    for (const zone of model.findings) {
      if (!mentionsId(slot.text, zone.materialId)) continue;
      const missing = missingReferences(slot.text, zone, false);
      if (missing.length > 0) {
        warnings.push({
          code: "ZONE_REFERENCE_INCOMPLETE",
          section,
          itemKey: "",
          message: `${NARRATIVE_LABELS[section]} mentions ${zone.materialId} without ${joinAnd(missing)}.`,
          excerpt: null,
        });
      }
    }
  };

  sectionLevel("executiveSummary");
  for (const zone of model.findings) {
    for (const section of ZONE_RECORD_SECTIONS) {
      warnings.push(...blockWarnings({ section, itemKey: zone.zoneId, text: textOf(section, zone.zoneId) }, words, zone));
    }
    const record = ZONE_RECORD_SECTIONS.map((section) => textOf(section, zone.zoneId)).filter((text) => !isBlank(text)).join("\n");
    if (record !== "") {
      const missing = missingReferences(record, zone, true);
      if (missing.length > 0) {
        warnings.push({
          code: "ZONE_REFERENCE_INCOMPLETE",
          section: null,
          itemKey: zone.zoneId,
          message: `The ${zone.materialId} findings texts do not mention ${joinAnd(missing)}.`,
          excerpt: null,
        });
      }
      if (zone.category === "D" && !/\bsampled material\b/i.test(record)) {
        warnings.push({
          code: "SAMPLED_SCOPE_MISSING",
          section: null,
          itemKey: zone.zoneId,
          message: `${zone.materialId} is not detected in the sampled material only; say that the finding is limited to the sampled material.`,
          excerpt: null,
        });
      }
    }
    const recommendation = { section: "recommendation" as const, itemKey: zone.zoneId, text: textOf("recommendation", zone.zoneId) };
    warnings.push(...blockWarnings(recommendation, words, zone));
    if (!isBlank(recommendation.text)) {
      const missing = missingReferences(recommendation.text, zone, true);
      if (missing.length > 0) {
        warnings.push({
          code: "ZONE_REFERENCE_INCOMPLETE",
          section: "recommendation",
          itemKey: zone.zoneId,
          message: `The ${zone.materialId} recommendation does not mention ${joinAnd(missing)}.`,
          excerpt: null,
        });
      }
    }
  }
  sectionLevel("limitations");

  // Slots for zones that no longer exist are not part of the report and are not checked.
  return warnings.filter((warning) => warning.itemKey === "" || zonesById.has(warning.itemKey));
}

/** Warnings for the model's own narrative blocks. */
export function checkNarrative(model: ReportModel): GuardWarning[] {
  return checkNarrativeBlocks(model, modelSlots(model));
}
