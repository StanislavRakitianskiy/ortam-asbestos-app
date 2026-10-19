"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/projects/field";
import { formatFieldValue } from "@/components/review/review-format";
import { useApplyDocument } from "@/components/review/use-review";
import { formatResultLabel } from "@/domain/format";
import {
  labReportIdInputSchema,
  labResultCorrectionSchema,
  labResultDecisionSchema,
  manualLabResultSchema,
  type EditableResultField,
  type LabResultCorrectionInput,
  type ManualLabResultInput,
} from "@/domain/labReviewInput";
import { RESULT_LABELS, type ResultLabel } from "@/domain/types";
import { ApiError, api } from "@/lib/api";
import type { FieldValue, LabDocumentDto, LabResultDto } from "@/server/services/labDocumentDto";

type Errors = Record<string, string>;

/** First message per field, keyed by the field name ("changes.sampleId" → "sampleId"); "form" for the rest. */
function issueErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Errors {
  const errors: Errors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).filter((part) => part !== "changes")[0] ?? "form";
    errors[key] ??= issue.message;
  }
  return errors;
}

function apiErrors(error: unknown): Errors {
  if (!(error instanceof ApiError)) return { form: error instanceof Error ? error.message : "Not saved." };
  const errors: Errors = {};
  for (const [field, messages] of Object.entries(error.fieldErrors)) errors[field.replace(/^changes\.?/, "") || "form"] ??= messages[0];
  if (Object.keys(errors).length === 0) errors.form = error.message;
  return errors;
}

/** Form text of the editable values. Result starts unselected for a new row so nothing is silently defaulted. */
type ValuesForm = {
  sampleId: string;
  layer: string;
  resultLabel: ResultLabel | "";
  asbestosType: string;
  percentage: string;
  labNote: string;
};

const EMPTY_VALUES: ValuesForm = { sampleId: "", layer: "", resultLabel: "", asbestosType: "", percentage: "", labNote: "" };

const valuesFromRow = (row: LabResultDto): ValuesForm => ({
  sampleId: row.sampleId,
  layer: row.layer,
  resultLabel: row.resultLabel,
  asbestosType: row.asbestosType ?? "",
  percentage: row.percentage === null ? "" : String(row.percentage),
  labNote: row.labNote ?? "",
});

/** "15", "15%" → 15; blank → null (not reported). Anything else is passed on so the schema reports it. */
function percentageValue(text: string): number | null | string {
  const trimmed = text.trim().replace(/\s*%$/, "");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : text;
}

const blankToNull = (text: string) => (text.trim() === "" ? null : text.trim());

/** The form as field values, comparable with a stored row. */
function formValues(form: ValuesForm): Record<EditableResultField, unknown> {
  return {
    sampleId: form.sampleId.trim(),
    layer: form.layer.trim(),
    resultLabel: form.resultLabel === "" ? undefined : form.resultLabel,
    asbestosType: blankToNull(form.asbestosType),
    percentage: percentageValue(form.percentage),
    labNote: blankToNull(form.labNote),
  };
}

function ResultFields({
  idPrefix,
  form,
  onChange,
  errors,
  aiValues,
}: {
  idPrefix: string;
  form: ValuesForm;
  onChange: (patch: Partial<ValuesForm>) => void;
  errors: Errors;
  /** The AI's values; a field whose value differs shows the AI value under it. */
  aiValues?: LabResultDto["aiValues"];
}) {
  const values = formValues(form);
  const aiHint = (field: EditableResultField): ReactNode => {
    if (!aiValues || !(field in aiValues)) return undefined;
    const original: FieldValue | undefined = aiValues[field];
    const same = (original ?? null) === (values[field] ?? null);
    return same ? undefined : `AI value: ${formatFieldValue(field, original)}`;
  };
  const id = (field: string) => `${idPrefix}-${field}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={id("sampleId")} label="Sample ID" error={errors.sampleId} hint={aiHint("sampleId")}>
        <Input
          {...fieldAria(id("sampleId"), errors.sampleId, Boolean(aiHint("sampleId")))}
          value={form.sampleId}
          onChange={(event) => onChange({ sampleId: event.target.value })}
          autoComplete="off"
        />
      </Field>
      <Field id={id("layer")} label="Layer" error={errors.layer} hint={aiHint("layer")}>
        <Input
          {...fieldAria(id("layer"), errors.layer, Boolean(aiHint("layer")))}
          value={form.layer}
          onChange={(event) => onChange({ layer: event.target.value })}
          autoComplete="off"
        />
      </Field>
      <Field id={id("resultLabel")} label="Result" error={errors.resultLabel} hint={aiHint("resultLabel")}>
        <Select value={form.resultLabel} onValueChange={(value) => onChange({ resultLabel: value as ResultLabel })}>
          <SelectTrigger {...fieldAria(id("resultLabel"), errors.resultLabel, Boolean(aiHint("resultLabel")))} className="w-full">
            <SelectValue placeholder="Choose the printed result" />
          </SelectTrigger>
          <SelectContent>
            {RESULT_LABELS.map((label) => (
              <SelectItem key={label} value={label}>
                {formatResultLabel(label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id={id("asbestosType")} label="Asbestos type" error={errors.asbestosType} hint={aiHint("asbestosType") ?? "Leave empty when not reported."}>
        <Input
          {...fieldAria(id("asbestosType"), errors.asbestosType, true)}
          value={form.asbestosType}
          onChange={(event) => onChange({ asbestosType: event.target.value })}
          autoComplete="off"
        />
      </Field>
      <Field id={id("percentage")} label="Content %" error={errors.percentage} hint={aiHint("percentage") ?? "0–100. Leave empty when not reported."}>
        <Input
          {...fieldAria(id("percentage"), errors.percentage, true)}
          value={form.percentage}
          onChange={(event) => onChange({ percentage: event.target.value })}
          inputMode="decimal"
          autoComplete="off"
        />
      </Field>
      <Field id={id("labNote")} label="Lab note" error={errors.labNote} hint={aiHint("labNote")} className="sm:col-span-2">
        <Textarea
          {...fieldAria(id("labNote"), errors.labNote, Boolean(aiHint("labNote")))}
          value={form.labNote}
          onChange={(event) => onChange({ labNote: event.target.value })}
          rows={2}
        />
      </Field>
    </div>
  );
}

function ReasonField({ id, value, onChange, error, label = "Reason" }: { id: string; value: string; onChange: (value: string) => void; error?: string; label?: string }) {
  return (
    <Field id={id} label={label} error={error} hint="Required. Stored in the correction log with the change.">
      <Input {...fieldAria(id, error, true)} value={value} onChange={(event) => onChange(event.target.value)} maxLength={300} autoComplete="off" />
    </Field>
  );
}

function FormError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

const rowTitle = (row: LabResultDto) => `${row.sampleId || "(no sample ID)"} · ${row.layer || "(no layer)"}`;

export function EditResultDialog({
  projectId,
  document,
  row,
  onClose,
}: {
  projectId: string;
  document: LabDocumentDto | undefined;
  row: LabResultDto | undefined;
  onClose: () => void;
}) {
  const open = document !== undefined && row !== undefined;
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        {open ? <EditForm key={row.id} projectId={projectId} document={document} row={row} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ projectId, document, row, onDone }: { projectId: string; document: LabDocumentDto; row: LabResultDto; onDone: () => void }) {
  const apply = useApplyDocument(projectId);
  const [form, setForm] = useState<ValuesForm>(() => valuesFromRow(row));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const save = useMutation({
    mutationFn: (input: LabResultCorrectionInput) => api.correctLabResult(projectId, document.id, row.id, input),
    onSuccess: (updated, input) => {
      apply(updated);
      toast.success(input.accept ? "Correction saved and row accepted." : "Correction saved. The row is pending review.");
      onDone();
    },
    onError: (error) => setErrors(apiErrors(error)),
  });

  function submit(accept: boolean) {
    const values = formValues(form);
    const current: Record<EditableResultField, unknown> = {
      sampleId: row.sampleId,
      layer: row.layer,
      resultLabel: row.resultLabel,
      asbestosType: row.asbestosType,
      percentage: row.percentage,
      labNote: row.labNote,
    };
    const changes = Object.fromEntries(
      (Object.keys(values) as EditableResultField[]).filter((field) => values[field] !== current[field]).map((field) => [field, values[field]]),
    );
    const input = { changes, reason, accept };
    const parsed = labResultCorrectionSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(issueErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(input as LabResultCorrectionInput);
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(false);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Correct {rowTitle(row)}</DialogTitle>
        <DialogDescription>
          The AI value stays in the record and every changed field is logged with your reason. Page {row.sourcePage} and the quoted line
          are evidence and cannot be edited: if they are wrong, reject this row and add it by hand.
        </DialogDescription>
      </DialogHeader>
      <ResultFields idPrefix="edit" form={form} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} errors={errors} aiValues={row.aiValues} />
      <ReasonField id="edit-reason" value={reason} onChange={setReason} error={errors.reason} label="Reason for the correction" />
      <FormError message={errors.form} />
      <DialogFooter>
        <Button type="submit" variant="outline" disabled={save.isPending}>
          Save correction
        </Button>
        <Button type="button" disabled={save.isPending} onClick={() => submit(true)}>
          Save and accept
        </Button>
      </DialogFooter>
    </form>
  );
}

export function RejectResultDialog({
  projectId,
  document,
  row,
  onClose,
}: {
  projectId: string;
  document: LabDocumentDto | undefined;
  row: LabResultDto | undefined;
  onClose: () => void;
}) {
  const open = document !== undefined && row !== undefined;
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        {open ? <RejectForm key={row.id} projectId={projectId} document={document} row={row} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RejectForm({ projectId, document, row, onDone }: { projectId: string; document: LabDocumentDto; row: LabResultDto; onDone: () => void }) {
  const apply = useApplyDocument(projectId);
  const [reason, setReason] = useState(row.rejectReason ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const reject = useMutation({
    mutationFn: (input: { decision: "REJECT"; reason: string }) => api.decideLabResult(projectId, document.id, row.id, input),
    onSuccess: (updated) => {
      apply(updated);
      toast.success(`${rowTitle(row)} rejected. It is not used in the report.`);
      onDone();
    },
    onError: (error) => setErrors(apiErrors(error)),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const input = { decision: "REJECT" as const, reason };
    const parsed = labResultDecisionSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(issueErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    reject.mutate(input);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Reject {rowTitle(row)}?</DialogTitle>
        <DialogDescription>
          A rejected row is kept for the record but never used for matching or the report. If the lab printed a result the AI got
          wrong, add the correct row by hand.
        </DialogDescription>
      </DialogHeader>
      <ReasonField id="reject-reason" value={reason} onChange={setReason} error={errors.reason} label="Reason for rejecting" />
      <FormError message={errors.form} />
      <DialogFooter showCloseButton>
        <Button type="submit" variant="destructive" disabled={reject.isPending}>
          Reject row
        </Button>
      </DialogFooter>
    </form>
  );
}

export function AddResultDialog({ projectId, document, onClose }: { projectId: string; document: LabDocumentDto | undefined; onClose: () => void }) {
  return (
    <Dialog open={document !== undefined} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        {document ? <AddForm key={document.id} projectId={projectId} document={document} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddForm({ projectId, document, onDone }: { projectId: string; document: LabDocumentDto; onDone: () => void }) {
  const apply = useApplyDocument(projectId);
  const [form, setForm] = useState<ValuesForm>(EMPTY_VALUES);
  const [page, setPage] = useState(document.pageCount === 1 ? "1" : "");
  const [quote, setQuote] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const add = useMutation({
    mutationFn: (input: ManualLabResultInput) => api.addLabResult(projectId, document.id, input),
    onSuccess: (updated) => {
      apply(updated);
      toast.success("Row added. It is pending review.");
      onDone();
    },
    onError: (error) => setErrors(apiErrors(error)),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const input = { ...formValues(form), sourcePage: page === "" ? undefined : Number(page), sourceText: quote, reason };
    const parsed = manualLabResultSchema.safeParse(input);
    const found = parsed.success ? {} : issueErrors(parsed.error.issues);
    if (form.resultLabel === "") found.resultLabel = "Choose the printed result.";
    if (page === "") found.sourcePage = "Choose the page the row is printed on.";
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    // Checked by the same schema just above.
    add.mutate(input as ManualLabResultInput);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Add a missing row to {document.fileName}</DialogTitle>
        <DialogDescription>
          For a sample layer the AI did not extract. Copy the row exactly as printed (you can select text in the Source viewer); the
          quote is checked against the PDF text like an extracted row.
        </DialogDescription>
      </DialogHeader>
      <ResultFields idPrefix="add" form={form} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} errors={errors} />
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field id="add-page" label="Page" error={errors.sourcePage}>
          <Select value={page} onValueChange={setPage}>
            <SelectTrigger {...fieldAria("add-page", errors.sourcePage)} className="w-full">
              <SelectValue placeholder="Page" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: document.pageCount }, (_, index) => String(index + 1)).map((value) => (
                <SelectItem key={value} value={value}>
                  Page {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="add-quote" label="Quoted line from the PDF" error={errors.sourceText} hint="The whole table row, e.g. sample, layer, result, type and content.">
          <Textarea
            {...fieldAria("add-quote", errors.sourceText, true)}
            value={quote}
            onChange={(event) => setQuote(event.target.value)}
            rows={2}
            className="font-mono text-xs md:text-xs"
          />
        </Field>
      </div>
      <ReasonField id="add-reason" value={reason} onChange={setReason} error={errors.reason} label="Why is this row added?" />
      <FormError message={errors.form} />
      <DialogFooter showCloseButton>
        <Button type="submit" disabled={add.isPending}>
          Add row
        </Button>
      </DialogFooter>
    </form>
  );
}

export function LabReportIdDialog({ projectId, document, onClose }: { projectId: string; document: LabDocumentDto | undefined; onClose: () => void }) {
  return (
    <Dialog open={document !== undefined} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        {document ? <LabReportIdForm key={document.id} projectId={projectId} document={document} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LabReportIdForm({ projectId, document, onDone }: { projectId: string; document: LabDocumentDto; onDone: () => void }) {
  const apply = useApplyDocument(projectId);
  const [labReportId, setLabReportId] = useState(document.labReportId ?? "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const save = useMutation({
    mutationFn: (input: { labReportId: string; reason: string }) => api.setLabReportId(projectId, document.id, input),
    onSuccess: (updated) => {
      apply(updated);
      toast.success(`Lab report ID of ${document.fileName} saved.`);
      onDone();
    },
    onError: (error) => setErrors(apiErrors(error)),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const input = { labReportId, reason };
    const parsed = labReportIdInputSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(issueErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    save.mutate(input);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Lab report ID of {document.fileName}</DialogTitle>
        <DialogDescription>
          Type the ID exactly as printed in the report header. It identifies the report in matching and in the report, and a new
          extraction keeps it.
        </DialogDescription>
      </DialogHeader>
      <Field id="lab-report-id" label="Lab report ID" error={errors.labReportId}>
        <Input
          {...fieldAria("lab-report-id", errors.labReportId)}
          value={labReportId}
          onChange={(event) => setLabReportId(event.target.value)}
          maxLength={60}
          autoComplete="off"
        />
      </Field>
      <ReasonField id="lab-report-id-reason" value={reason} onChange={setReason} error={errors.reason} />
      <FormError message={errors.form} />
      <DialogFooter showCloseButton>
        <Button type="submit" disabled={save.isPending}>
          Save ID
        </Button>
      </DialogFooter>
    </form>
  );
}
