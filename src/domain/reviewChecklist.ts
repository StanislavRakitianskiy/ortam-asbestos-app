import { z } from "zod";

/** The final review items of the Word master, in its order. */
export const CHECKLIST_ITEMS = [
  { key: "samplesChecked", label: "Sample matching checked", short: "Sample matching" },
  { key: "layersChecked", label: "Layers checked", short: "Layers" },
  { key: "quantitiesChecked", label: "Quantities checked", short: "Quantities" },
  { key: "costsChecked", label: "Costs checked", short: "Costs" },
  { key: "narrativeChecked", label: "Narrative checked", short: "Narrative" },
] as const;

export type ChecklistKey = (typeof CHECKLIST_ITEMS)[number]["key"];

export type ReviewChecklistState = Record<ChecklistKey, boolean> & {
  reviewerName: string | null;
  /** Calendar day "YYYY-MM-DD" (D-013), null until entered. */
  reviewedOn: string | null;
};

/** Nothing checked yet: the state of a project that has no checklist row. */
export const EMPTY_CHECKLIST: ReviewChecklistState = {
  samplesChecked: false,
  layersChecked: false,
  quantitiesChecked: false,
  costsChecked: false,
  narrativeChecked: false,
  reviewerName: null,
  reviewedOn: null,
};

const REVIEWER_MAX = 120;

/** The whole checklist is sent on every save; a blank reviewer name is stored as null. */
export const reviewChecklistInputSchema = z.strictObject({
  samplesChecked: z.boolean(),
  layersChecked: z.boolean(),
  quantitiesChecked: z.boolean(),
  costsChecked: z.boolean(),
  narrativeChecked: z.boolean(),
  reviewerName: z
    .string()
    .trim()
    .max(REVIEWER_MAX, { error: `must be at most ${REVIEWER_MAX} characters` })
    .nullable()
    .transform((value) => (value === null || value === "" ? null : value)),
  reviewedOn: z.iso.date({ error: "must be a date (YYYY-MM-DD)" }).nullable(),
});
export type ReviewChecklistInput = z.input<typeof reviewChecklistInputSchema>;
