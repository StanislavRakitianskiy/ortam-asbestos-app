"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria, issuesToFieldErrors } from "@/components/projects/field";
import { useUnsavedChanges } from "@/components/projects/unsaved-changes";
import { projectUpdateSchema, type ProjectUpdateInput } from "@/domain/projectInput";
import type { ProjectDetail, ProjectDto } from "@/server/services/projectService";
import { api, firstFieldErrors, queryKeys } from "@/lib/api";

/** Everything the form edits, as input text. Empty dates and an empty reviewer are sent as null. */
type FormValues = {
  code: string;
  client: string;
  building: string;
  address: string;
  inspectionDate: string;
  reportDate: string;
  preparedBy: string;
  reviewedBy: string;
  scope: string;
  plannedWork: string;
  limitations: string;
  jurisdictionNote: string;
};

const toFormValues = (project: ProjectDto): FormValues => ({
  code: project.code,
  client: project.client,
  building: project.building,
  address: project.address,
  inspectionDate: project.inspectionDate ?? "",
  reportDate: project.reportDate ?? "",
  preparedBy: project.preparedBy,
  reviewedBy: project.reviewedBy ?? "",
  scope: project.scope,
  plannedWork: project.plannedWork,
  limitations: project.limitations,
  jurisdictionNote: project.jurisdictionNote,
});

const toPatch = (values: FormValues): ProjectUpdateInput => ({
  ...values,
  inspectionDate: values.inspectionDate === "" ? null : values.inspectionDate,
  reportDate: values.reportDate === "" ? null : values.reportDate,
  reviewedBy: values.reviewedBy.trim() === "" ? null : values.reviewedBy,
});

const sameValues = (a: FormValues, b: FormValues) =>
  (Object.keys(a) as (keyof FormValues)[]).every((key) => a[key] === b[key]);

type TextField = { name: keyof FormValues; label: string; hint?: string; type?: "date"; placeholder?: string };

const DETAILS: TextField[] = [
  { name: "code", label: "Project code" },
  { name: "client", label: "Client" },
  { name: "building", label: "Building" },
  { name: "address", label: "Address" },
  { name: "inspectionDate", label: "Inspection date", type: "date" },
  { name: "reportDate", label: "Report date", type: "date" },
  { name: "preparedBy", label: "Prepared by" },
  { name: "reviewedBy", label: "Reviewed by", placeholder: "Pending", hint: "Leave blank while the review is pending." },
];

const LONG_TEXT: TextField[] = [
  { name: "scope", label: "Inspection scope", hint: "What was inspected, e.g. accessible areas only." },
  { name: "plannedWork", label: "Planned work", hint: "Renovation or other work that may disturb materials." },
  { name: "limitations", label: "Limitations", hint: "Areas not accessed, materials not sampled, other limits." },
  { name: "jurisdictionNote", label: "Jurisdiction note" },
];

export function ProjectForm({ project }: { project: ProjectDto }) {
  const queryClient = useQueryClient();
  const { setDirty } = useUnsavedChanges();
  const [values, setValues] = useState(() => toFormValues(project));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const dirty = !sameValues(values, toFormValues(project));
  useEffect(() => setDirty(dirty), [dirty, setDirty]);

  const save = useMutation({
    mutationFn: (patch: ProjectUpdateInput) => api.updateProject(project.id, patch),
    onSuccess: (saved) => {
      queryClient.setQueryData<ProjectDetail>(queryKeys.project(project.id), (current) =>
        current ? { ...current, project: saved } : current,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      setValues(toFormValues(saved));
      setErrors({});
      toast.success("Project saved.");
    },
    onError: (error) => {
      setErrors(firstFieldErrors(error));
      toast.error(`Not saved. ${error.message}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const patch = toPatch(values);
    const parsed = projectUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      setErrors(issuesToFieldErrors(parsed.error.issues));
      toast.error("Not saved. Please correct the highlighted fields.");
      return;
    }
    if (patch.inspectionDate && patch.reportDate && patch.reportDate < patch.inspectionDate) {
      setErrors({ reportDate: "must be on or after the inspection date" });
      return;
    }
    save.mutate(patch);
  }

  const set = (name: keyof FormValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [name]: event.target.value }));

  const renderField = (field: TextField, multiline: boolean) => {
    const id = `project-${field.name}`;
    const error = errors[field.name];
    const aria = fieldAria(id, error, Boolean(field.hint));
    return (
      <Field
        key={field.name}
        id={id}
        label={field.label}
        error={error}
        hint={field.hint}
        className={multiline ? "sm:col-span-2" : undefined}
      >
        {multiline ? (
          <Textarea {...aria} value={values[field.name]} onChange={set(field.name)} rows={3} />
        ) : (
          <Input
            {...aria}
            type={field.type ?? "text"}
            value={values[field.name]}
            placeholder={field.placeholder}
            onChange={set(field.name)}
          />
        )}
      </Field>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Project information</CardTitle>
            <CardDescription>Building, inspection and scope details used on the report cover and scope section.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {DETAILS.map((field) => renderField(field, false))}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Currency</span>
                <span className="text-sm text-muted-foreground">CAD (fixed for this exercise)</span>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">{LONG_TEXT.map((field) => renderField(field, true))}</div>

            <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t bg-card px-4 pt-4 pb-1">
              <Button type="submit" disabled={!dirty || save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setValues(toFormValues(project));
                  setErrors({});
                }}
              >
                Discard changes
              </Button>
              <span role="status" aria-live="polite">
                {dirty ? (
                  <Badge className="bg-amber-500/15 text-amber-800 dark:text-amber-300">Unsaved changes</Badge>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CircleCheckIcon className="size-3.5" aria-hidden />
                    All changes saved
                  </span>
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      </form>
      <DeleteProject project={project} />
    </div>
  );
}

function DeleteProject({ project }: { project: ProjectDto }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setDirty } = useUnsavedChanges();
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: () => {
      setDirty(false);
      queryClient.removeQueries({ queryKey: queryKeys.project(project.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      toast.success(`Project ${project.code} deleted.`);
      router.push("/");
    },
    onError: (error) => toast.error(`Not deleted. ${error.message}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete project</CardTitle>
        <CardDescription>Removes the project with all its material zones. This cannot be undone.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <TrashIcon aria-hidden />
          Delete project
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete project {project.code}?</DialogTitle>
              <DialogDescription>
                The project, its material zones and sample IDs are removed permanently.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton>
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? "Deleting…" : "Delete project"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
