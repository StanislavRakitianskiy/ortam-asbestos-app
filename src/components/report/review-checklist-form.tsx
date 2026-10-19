"use client";

import { useState, type FormEvent } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Field, fieldAria } from "@/components/projects/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveChecklist } from "@/components/report/use-report";
import type { ReportModel } from "@/domain/reportModel";
import { CHECKLIST_ITEMS, type ChecklistKey, type ReviewChecklistState } from "@/domain/reviewChecklist";
import { firstFieldErrors } from "@/lib/api";

function stateOf(review: ReportModel["employeeReview"]): ReviewChecklistState {
  const checked = Object.fromEntries(review.checklist.map((item) => [item.key, item.checked])) as Record<ChecklistKey, boolean>;
  return { ...checked, reviewerName: review.reviewerName, reviewedOn: review.reviewedOn };
}

/** A blank reviewer is stored as null, so it compares equal to null. */
const normalized = (state: ReviewChecklistState) => ({ ...state, reviewerName: state.reviewerName?.trim() || null });
const sameState = (first: ReviewChecklistState, second: ReviewChecklistState) =>
  JSON.stringify(normalized(first)) === JSON.stringify(normalized(second));

/** The final review items of the Word master, the reviewer and the day. The report stays a draft whatever is checked. */
export function ReviewChecklistForm({
  projectId,
  review,
  narrativeWarnings,
}: {
  projectId: string;
  review: ReportModel["employeeReview"];
  narrativeWarnings: number;
}) {
  const save = useSaveChecklist(projectId);
  const stored = stateOf(review);
  const [form, setForm] = useState(stored);
  const [storedSeen, setStoredSeen] = useState(stored);
  const dirty = !sameState(form, stored);
  const errors = firstFieldErrors(save.error);

  // Saved elsewhere (another tab, or this form's own save): show the stored values unless there are unsaved edits.
  if (!sameState(storedSeen, stored)) {
    setStoredSeen(stored);
    if (sameState(form, storedSeen)) setForm(stored);
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(form, { onSuccess: () => toast.success("Review checklist saved. The report stays a draft pending professional review.") });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Employee review checklist">
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-1 text-sm font-medium">Final review</legend>
        {CHECKLIST_ITEMS.map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <Checkbox
              id={`checklist-${item.key}`}
              checked={form[item.key]}
              onCheckedChange={(checked) => setForm((current) => ({ ...current, [item.key]: checked === true }))}
            />
            <Label htmlFor={`checklist-${item.key}`} className="font-normal">
              {item.label}
            </Label>
            {item.key === "narrativeChecked" && narrativeWarnings > 0 ? (
              <span className="text-xs text-amber-800 dark:text-amber-300">
                {narrativeWarnings} guardrail warning{narrativeWarnings === 1 ? "" : "s"} open
              </span>
            ) : null}
          </div>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="checklist-reviewer" label="Reviewer" error={errors.reviewerName}>
          <Input
            {...fieldAria("checklist-reviewer", errors.reviewerName)}
            value={form.reviewerName ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, reviewerName: event.target.value }))}
            maxLength={120}
            autoComplete="off"
          />
        </Field>
        <Field id="checklist-date" label="Review date" error={errors.reviewedOn}>
          <Input
            {...fieldAria("checklist-date", errors.reviewedOn)}
            type="date"
            value={form.reviewedOn ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, reviewedOn: event.target.value === "" ? null : event.target.value }))}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
          Save review checklist
        </Button>
        {dirty ? <span className="text-xs text-amber-800 dark:text-amber-300">Unsaved changes</span> : null}
        {save.isError && Object.keys(errors).length === 0 ? (
          <span role="alert" className="text-sm text-destructive">
            Not saved: {save.error.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
