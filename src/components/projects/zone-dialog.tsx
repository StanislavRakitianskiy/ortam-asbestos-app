"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria, issuesToFieldErrors } from "@/components/projects/field";
import { SampleIdInput } from "@/components/projects/sample-id-input";
import { formatCad } from "@/domain/format";
import { splitSampleIds, zoneCreateSchema, type ZoneCreateInput } from "@/domain/projectInput";
import { RATE_CARD } from "@/domain/rates";
import { CONDITIONS, type Condition, type MaterialZone, type Unit } from "@/domain/types";
import { zoneWarnings } from "@/domain/zoneWarnings";
import { api, firstFieldErrors, queryKeys } from "@/lib/api";
import { CONDITION_LABELS, UNIT_LABELS } from "@/components/projects/labels";

const NOT_ASSIGNED = "none";

type YesNo = "yes" | "no";

/** Form state. Choices that change the outcome start empty so nothing is silently defaulted. */
type ZoneForm = {
  materialId: string;
  description: string;
  floor: string;
  location: string;
  sampleIds: string[];
  quantity: string;
  quantityUnknown: boolean;
  unit: Unit | "";
  condition: Condition | "";
  plannedDisturbance: YesNo | "";
  rateRef: string;
  accessible: YesNo;
  notes: string;
};

const EMPTY_FORM: ZoneForm = {
  materialId: "",
  description: "",
  floor: "",
  location: "",
  sampleIds: [],
  quantity: "",
  quantityUnknown: false,
  unit: "",
  condition: "",
  plannedDisturbance: "",
  rateRef: NOT_ASSIGNED,
  accessible: "yes",
  notes: "",
};

const toForm = (zone: MaterialZone): ZoneForm => ({
  materialId: zone.materialId,
  description: zone.description,
  floor: zone.floor,
  location: zone.location,
  sampleIds: zone.sampleIds,
  quantity: zone.quantity === null ? "" : String(zone.quantity),
  quantityUnknown: zone.quantity === null,
  unit: zone.unit,
  condition: zone.condition,
  plannedDisturbance: zone.plannedDisturbance ? "yes" : "no",
  rateRef: zone.rateRef ?? NOT_ASSIGNED,
  accessible: zone.accessible ? "yes" : "no",
  notes: zone.notes,
});

/** The quantity as the API expects it: null for Unknown, a number otherwise. Empty text stays undefined (an error). */
function quantityValue(form: ZoneForm): number | null | undefined {
  if (form.quantityUnknown) return null;
  if (form.quantity.trim() === "") return undefined;
  return Number(form.quantity);
}

function choiceErrors(form: ZoneForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (quantityValue(form) === undefined) errors.quantity = "Enter a quantity, or tick Unknown if it was not measured.";
  if (form.unit === "") errors.unit = "Choose a unit.";
  if (form.condition === "") errors.condition = "Choose a condition.";
  if (form.plannedDisturbance === "") errors.plannedDisturbance = "Choose Yes or No.";
  return errors;
}

export function ZoneDialog({
  open,
  onOpenChange,
  projectId,
  zone,
  zones,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** The zone to edit; undefined to add a new one. */
  zone?: MaterialZone;
  zones: readonly MaterialZone[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        {/* Remounted on every open so the form starts from the saved zone. */}
        {open ? (
          <ZoneFormBody
            key={zone?.id ?? "new"}
            projectId={projectId}
            zone={zone}
            zones={zones}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ZoneFormBody({
  projectId,
  zone,
  zones,
  onDone,
}: {
  projectId: string;
  zone?: MaterialZone;
  zones: readonly MaterialZone[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ZoneForm>(() => (zone ? toForm(zone) : EMPTY_FORM));
  const [sampleDraft, setSampleDraft] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = <K extends keyof ZoneForm>(name: K, value: ZoneForm[K]) => {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!(name in current) && !(name === "quantityUnknown" && "quantity" in current)) return current;
      const next = { ...current };
      delete next[name];
      if (name === "quantityUnknown") delete next.quantity;
      return next;
    });
  };

  const save = useMutation({
    mutationFn: (input: ZoneCreateInput) =>
      zone ? api.updateZone(projectId, zone.id, input) : api.addZone(projectId, input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      toast.success(zone ? `Zone ${saved.materialId} saved.` : `Zone ${saved.materialId} added.`);
      onDone();
    },
    onError: (error) => {
      setErrors(firstFieldErrors(error));
      toast.error(`Not saved. ${error.message}`);
    },
  });

  // Text typed in the sample field but not yet turned into a chip still counts.
  const sampleIds = [...form.sampleIds, ...splitSampleIds(sampleDraft).filter((id) => !form.sampleIds.includes(id))];
  const quantity = quantityValue(form);
  const warnings = zoneWarnings(
    {
      id: zone?.id,
      sampleIds,
      quantity,
      unit: form.unit === "" ? null : form.unit,
      rateRef: form.rateRef === NOT_ASSIGNED ? null : form.rateRef,
    },
    zones,
  );
  const warningOf = (type: string) => warnings.filter((warning) => warning.type === type);
  const flaggedSamples = new Set(
    warnings.flatMap((warning) => (warning.type === "SAMPLE_IN_OTHER_ZONE" ? [warning.sampleId] : [])),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const input = {
      materialId: form.materialId,
      description: form.description,
      floor: form.floor,
      location: form.location,
      sampleIds,
      quantity,
      unit: form.unit,
      condition: form.condition,
      plannedDisturbance: form.plannedDisturbance === "yes",
      rateRef: form.rateRef === NOT_ASSIGNED ? null : form.rateRef,
      accessible: form.accessible === "yes",
      notes: form.notes,
    };
    const parsed = zoneCreateSchema.safeParse(input);
    const found = { ...(parsed.success ? {} : issuesToFieldErrors(parsed.error.issues)), ...choiceErrors(form) };
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setForm((current) => ({ ...current, sampleIds }));
    setSampleDraft("");
    save.mutate(input as ZoneCreateInput);
  }

  const text = (name: "materialId" | "description" | "floor" | "location", label: string, hint?: string) => (
    <Field id={`zone-${name}`} label={label} error={errors[name]} hint={hint}>
      <Input
        {...fieldAria(`zone-${name}`, errors[name], Boolean(hint))}
        value={form[name]}
        onChange={(event) => update(name, event.target.value)}
      />
    </Field>
  );

  const selectedRate = form.rateRef === NOT_ASSIGNED ? null : RATE_CARD[form.rateRef];

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{zone ? `Edit zone ${zone.materialId}` : "Add material zone"}</DialogTitle>
        <DialogDescription>
          One measured area or length of one material. Several samples of the same material belong in one zone.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        {text("materialId", "Material ID", "For example M01.")}
        {text("description", "Description", "For example Pipe insulation.")}
        {text("floor", "Floor")}
        {text("location", "Precise location", "Room or area, e.g. B01 mechanical room.")}

        <Field
          id="zone-sampleIds"
          label="Sample IDs"
          error={errors.sampleIds}
          hint="Exactly as on the sample label. Leave empty if the material was not sampled."
          className="sm:col-span-2"
        >
          <SampleIdInput
            id="zone-sampleIds"
            value={form.sampleIds}
            onChange={(ids) => update("sampleIds", ids)}
            draft={sampleDraft}
            onDraftChange={setSampleDraft}
            flagged={flaggedSamples}
            invalid={Boolean(errors.sampleIds)}
            describedBy="zone-sampleIds-hint"
          />
          {warningOf("SAMPLE_IN_OTHER_ZONE").map((warning) => (
            <Warning key={warning.message}>{warning.message}</Warning>
          ))}
        </Field>

        <Field id="zone-quantity" label="Quantity" error={errors.quantity}>
          <div className="flex items-center gap-3">
            <Input
              {...fieldAria("zone-quantity", errors.quantity)}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="w-36"
              value={form.quantityUnknown ? "" : form.quantity}
              placeholder={form.quantityUnknown ? "Unknown" : undefined}
              disabled={form.quantityUnknown}
              onChange={(event) => update("quantity", event.target.value)}
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="zone-quantity-unknown"
                checked={form.quantityUnknown}
                onCheckedChange={(checked) => update("quantityUnknown", checked === true)}
              />
              <Label htmlFor="zone-quantity-unknown" className="font-normal">
                Unknown (not measured)
              </Label>
            </div>
          </div>
          {warningOf("UNKNOWN_QUANTITY").map((warning) => (
            <Warning key={warning.message}>{warning.message}</Warning>
          ))}
        </Field>

        <Field id="zone-unit" label="Unit" error={errors.unit}>
          <Select value={form.unit} onValueChange={(value) => update("unit", value as Unit)}>
            <SelectTrigger {...fieldAria("zone-unit", errors.unit)} className="w-full">
              <SelectValue placeholder="Choose a unit" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(UNIT_LABELS) as Unit[]).map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {UNIT_LABELS[unit]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id="zone-condition" label="Condition" error={errors.condition}>
          <Select value={form.condition} onValueChange={(value) => update("condition", value as Condition)}>
            <SelectTrigger {...fieldAria("zone-condition", errors.condition)} className="w-full">
              <SelectValue placeholder="Choose a condition" />
            </SelectTrigger>
            <SelectContent>
              {CONDITIONS.map((condition) => (
                <SelectItem key={condition} value={condition}>
                  {CONDITION_LABELS[condition]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <YesNoField
          id="zone-plannedDisturbance"
          label="Planned disturbance"
          hint="Will planned work affect this material?"
          value={form.plannedDisturbance}
          onChange={(value) => update("plannedDisturbance", value)}
          error={errors.plannedDisturbance}
        />

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Field id="zone-rateRef" label="Rate reference" error={errors.rateRef}>
            <Select value={form.rateRef} onValueChange={(value) => update("rateRef", value)}>
              <SelectTrigger {...fieldAria("zone-rateRef", errors.rateRef)} className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_ASSIGNED}>Not assigned</SelectItem>
                {Object.values(RATE_CARD).map((rate) => (
                  <SelectItem key={rate.ref} value={rate.ref}>
                    {rate.ref} · {rate.material}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {[...warningOf("RATE_UNIT_MISMATCH"), ...warningOf("UNKNOWN_RATE_REF")].map((warning) => (
            <Warning key={warning.message}>{warning.message}</Warning>
          ))}
          <RateCardTable selected={selectedRate?.ref ?? null} />
        </div>

        <YesNoField
          id="zone-accessible"
          label="Accessible"
          hint="No if the area could not be entered or inspected."
          value={form.accessible}
          onChange={(value) => update("accessible", value)}
        />

        <Field id="zone-notes" label="Notes" error={errors.notes} className="sm:col-span-2">
          <Textarea
            {...fieldAria("zone-notes", errors.notes)}
            value={form.notes}
            rows={2}
            onChange={(event) => update("notes", event.target.value)}
          />
        </Field>
      </div>

      <DialogFooter showCloseButton>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : zone ? "Save zone" : "Add zone"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
      <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function YesNoField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint?: string;
  value: YesNo | "";
  onChange: (value: YesNo) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as YesNo)}
        className="flex h-8 items-center gap-5"
        aria-labelledby={`${id}-label`}
        aria-describedby={[hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
      >
        {(["yes", "no"] as const).map((option) => (
          <div key={option} className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-${option}`} value={option} aria-invalid={error ? true : undefined} />
            <Label htmlFor={`${id}-${option}`} className="font-normal">
              {option === "yes" ? "Yes" : "No"}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The fictional rate card, read-only, with the chosen row highlighted. */
function RateCardTable({ selected }: { selected: string | null }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <caption className="px-2 pt-2 text-left text-muted-foreground">Rate card (CAD per unit, read-only)</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="px-2 py-1 font-medium">Ref</th>
            <th className="px-2 py-1 font-medium">Material</th>
            <th className="px-2 py-1 font-medium">Unit</th>
            <th className="px-2 py-1 text-right font-medium">Removal</th>
            <th className="px-2 py-1 text-right font-medium">Replacement</th>
          </tr>
        </thead>
        <tbody>
          {Object.values(RATE_CARD).map((rate) => (
            <tr
              key={rate.ref}
              className={rate.ref === selected ? "bg-muted font-medium" : undefined}
              aria-current={rate.ref === selected || undefined}
            >
              <td className="px-2 py-1">{rate.ref}</td>
              <td className="px-2 py-1">{rate.material}</td>
              <td className="px-2 py-1">{rate.unit}</td>
              <td className="px-2 py-1 text-right tabular-nums">{formatCad(rate.removalRate)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{formatCad(rate.replacementRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
