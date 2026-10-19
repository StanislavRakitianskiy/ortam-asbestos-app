"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, fieldAria, issuesToFieldErrors } from "@/components/projects/field";
import { projectCreateSchema } from "@/domain/projectInput";
import { api, firstFieldErrors, queryKeys } from "@/lib/api";

const EMPTY = { code: "", client: "", building: "" };

export function NewProjectDialog() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: api.createProject,
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      toast.success(`Project ${project.code} created.`);
      setOpen(false);
      router.push(`/projects/${project.id}`);
    },
    onError: (error) => {
      setErrors(firstFieldErrors(error));
      toast.error(error.message);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = projectCreateSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(issuesToFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    create.mutate(values);
  }

  const set = (field: keyof typeof EMPTY) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setValues(EMPTY);
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon aria-hidden />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>You can fill in the dates, scope and limitations on the next page.</DialogDescription>
          </DialogHeader>
          <Field id="new-code" label="Project code" error={errors.code} hint="For example ORTAM-DEMO-001.">
            <Input {...fieldAria("new-code", errors.code, true)} value={values.code} onChange={set("code")} autoFocus />
          </Field>
          <Field id="new-client" label="Client" error={errors.client}>
            <Input {...fieldAria("new-client", errors.client)} value={values.client} onChange={set("client")} />
          </Field>
          <Field id="new-building" label="Building" error={errors.building}>
            <Input {...fieldAria("new-building", errors.building)} value={values.building} onChange={set("building")} />
          </Field>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
