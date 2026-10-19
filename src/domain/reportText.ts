import { formatCad } from "./format";
import { CONTINGENCY_PERCENT } from "./rates";
import type { Category, Cents } from "./types";

/**
 * Fixed report wording and the text the report builds in code. Wording comes from the Word master
 * (fixtures/master_asbestos_report.docx) and the exercise rules where they give one. AI never writes these texts.
 */

/** The report status. It never changes: the app does not approve a report. */
export const REPORT_STATUS = "Draft pending human and professional review";

/** First line of the master. */
export const FICTIONAL_NOTICE = "FICTIONAL HIRING EXERCISE ONLY - NOT A REAL LAB RESULT OR PROPERTY ASSESSMENT";

export const DISCLAIMERS = {
  fictionalExercise:
    "All buildings, samples, results and prices in this report are fictional exercise inputs. This draft does not qualify a property for work or certify its safety.",
  noComplianceOrClearance: "This draft does not claim legal compliance, building-wide absence of asbestos, safety or clearance.",
  sampledMaterialOnly:
    "A not detected result applies only to the sampled material. A negative sample does not establish that an entire room or building is free of asbestos.",
  noAirOrClearanceData: "No air exposure measurement or clearance evidence is supplied.",
  notAQuotation: "Fictional exercise prices are not quotations.",
  professionalValidation: "Real use requires qualified professional validation and jurisdiction-specific requirements.",
} as const;

/** Cost scenario introduction, verbatim from the master. */
export const COST_SCENARIO_TEXT =
  "Scenario: full removal and replacement of confirmed detected zones with known quantities. All rates and allowances are fictional exercise inputs. This is not a contractor quote or an instruction to carry out work.";

/** How the cost scenario treats quantities and amounts, from the exercise rules. */
export const COST_ASSUMPTIONS = [
  "Quantities come only from the material zones entered by the employee; a lab result never supplies a quantity.",
  "A material zone with several samples is charged once for its measured quantity.",
  "Only detected zones with a known quantity and a rate in the zone's unit are priced. An unknown quantity stays unknown and is never replaced with zero.",
  "Mobilization and the professional assessment allowance are added once per project when at least one zone is priced.",
  `Contingency is ${CONTINGENCY_PERCENT} percent of the direct subtotal. All amounts are in CAD before tax.`,
  "The scenario does not recommend removing every detected material.",
] as const;

/** Standing limitations that apply to every report. */
export const HIDDEN_MATERIALS_LIMITATION =
  "Hidden materials that are not listed as material zones (for example inside walls, above ceilings or below floors) were not inspected or sampled.";

export type ReportCounts = {
  zones: number;
  /** Distinct registered sample IDs. A sample ID listed in two zones counts once. */
  samples: number;
  /** Lab layer results of the registered samples. */
  layerResults: number;
  detectedZones: number;
  notDetectedZones: number;
  unresolvedZones: number;
  pricedZones: number;
  byCategory: Record<Category, number>;
};

export type ZoneMention = { materialId: string; description: string; detail: string };

export type FactsParagraphInput = {
  counts: ReportCounts;
  detected: readonly string[];
  notDetected: readonly string[];
  unresolved: readonly string[];
  totals: { zoneSubtotal: Cents; direct: Cents; contingency: Cents; total: Cents };
  /** Detected zones without a price, with the reason. */
  notPriced: readonly ZoneMention[];
  /** Unresolved zones, with the reason. */
  unresolvedDetails: readonly ZoneMention[];
};

export const plural = (count: number, word: string, pluralWord = `${word}s`) => `${count} ${count === 1 ? word : pluralWord}`;

/** "A, B and C". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const ids = (materialIds: readonly string[]) => `(${materialIds.join(", ")})`;
const mention = (zone: ZoneMention) => `${zone.materialId} ${zone.description} (${zone.detail})`;

/**
 * The second executive summary paragraph: counts, amounts, unpriced and unresolved zones. Built in code from the
 * analysis so no number in it ever comes from the AI.
 */
export function factsParagraph(input: FactsParagraphInput): string {
  const { counts, totals } = input;
  const sentences: string[] = [
    `This draft covers ${plural(counts.zones, "material zone")} with ${plural(counts.samples, "registered sample")} and ${plural(counts.layerResults, "laboratory layer result")}.`,
  ];

  const findings: string[] = [];
  if (input.detected.length > 0) findings.push(`detected in ${plural(input.detected.length, "zone")} ${ids(input.detected)}`);
  if (input.notDetected.length > 0) {
    findings.push(`not detected in the sampled material of ${plural(input.notDetected.length, "zone")} ${ids(input.notDetected)}`);
  }
  if (findings.length > 0) sentences.push(`Asbestos was ${joinAnd(findings)}.`);
  if (input.unresolved.length > 0) {
    sentences.push(`${plural(input.unresolved.length, "zone remains", "zones remain")} unresolved ${ids(input.unresolved)}.`);
  }

  if (counts.pricedZones > 0) {
    sentences.push(
      `The illustrative cost scenario prices ${plural(counts.pricedZones, "zone")}: measured zone subtotal CAD ${formatCad(totals.zoneSubtotal)}, ` +
        `direct subtotal CAD ${formatCad(totals.direct)} including mobilization and the professional assessment allowance, ` +
        `contingency at ${CONTINGENCY_PERCENT} percent CAD ${formatCad(totals.contingency)}, illustrative total before tax CAD ${formatCad(totals.total)}.`,
    );
  } else {
    sentences.push("The illustrative cost scenario prices no zone, so no allowance or contingency is added.");
  }
  if (input.notPriced.length > 0) sentences.push(`Detected but not priced: ${input.notPriced.map(mention).join("; ")}.`);
  if (input.unresolvedDetails.length > 0) {
    sentences.push(`Unresolved and not priced: ${input.unresolvedDetails.map(mention).join("; ")}.`);
  }
  sentences.push(DISCLAIMERS.notAQuotation);
  return sentences.join(" ");
}
