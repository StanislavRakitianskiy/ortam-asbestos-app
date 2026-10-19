"use client";

import { useEffect, useState } from "react";
import { LoaderCircleIcon, PencilIcon, RotateCcwIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useResetNarrative, useSaveNarrative } from "@/components/report/use-report";
import { NARRATIVE_TEXT_MAX, type NarrativeBlock, type NarrativeSection } from "@/domain/narrative";
import { GUARD_TITLES, type GuardWarning } from "@/domain/textGuards";
import { cn } from "@/lib/utils";

export const narrativeFieldId = (section: NarrativeSection, itemKey: string) => `narrative-${section}${itemKey === "" ? "" : `-${itemKey}`}`;

export function SourceBadge({ source }: { source: NarrativeBlock["source"] }) {
  if (source === "AI_DRAFT") {
    return (
      <Badge variant="secondary" className="bg-violet-500/10 text-violet-900 dark:text-violet-200">
        <SparklesIcon aria-hidden />
        AI draft
      </Badge>
    );
  }
  if (source === "EDITED") {
    return (
      <Badge variant="outline">
        <PencilIcon aria-hidden />
        Edited by employee
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Not drafted
    </Badge>
  );
}

export function GuardWarnings({ warnings, className }: { warnings: readonly GuardWarning[]; className?: string }) {
  if (warnings.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-1.5", className)} aria-label="Guardrail warnings">
      {warnings.map((warning, index) => (
        <li
          key={`${warning.code}-${index}`}
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-950 dark:text-amber-100"
        >
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">{GUARD_TITLES[warning.code]}.</span> {warning.message}
            {warning.excerpt ? <span className="mt-0.5 block italic opacity-80">“{warning.excerpt}”</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One editable narrative text: the AI draft or the employee's version, saved when the field loses focus. The AI
 * original stays available through "Reset to AI draft". Guardrail warnings are shown beside it and never block saving.
 */
export function NarrativeField({
  projectId,
  block,
  label,
  warnings,
  hint,
}: {
  projectId: string;
  block: NarrativeBlock;
  label: string;
  warnings: readonly GuardWarning[];
  hint?: string;
}) {
  const save = useSaveNarrative(projectId);
  const reset = useResetNarrative(projectId);
  const [value, setValue] = useState(block.text);
  const [serverText, setServerText] = useState(block.text);
  const id = narrativeFieldId(block.section, block.itemKey);
  const dirty = value.trim() !== block.text;

  // A new AI draft or a reset changed the stored text: show it, unless the employee has unsaved edits here.
  if (serverText !== block.text) {
    setServerText(block.text);
    if (value.trim() === serverText) setValue(block.text);
  }

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const submit = () => {
    if (dirty && !save.isPending) save.mutate({ section: block.section, itemKey: block.itemKey, text: value });
  };
  const canReset = block.aiText !== null && (block.source === "EDITED" || dirty);
  const tooLong = value.length > NARRATIVE_TEXT_MAX;

  return (
    <div id={id} className="flex scroll-mt-24 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-text`} className="text-sm font-medium">
          {label}
        </label>
        <SourceBadge source={block.source} />
        {dirty ? <span className="text-xs text-amber-800 dark:text-amber-300">Unsaved changes</span> : null}
        {canReset ? (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            disabled={reset.isPending || save.isPending}
            onClick={() =>
              reset.mutate({ section: block.section, itemKey: block.itemKey }, { onSuccess: () => setValue(block.aiText ?? "") })
            }
          >
            <RotateCcwIcon aria-hidden />
            Reset to AI draft
          </Button>
        ) : null}
      </div>
      <Textarea
        id={`${id}-text`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={submit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
        }}
        placeholder={block.source === "NONE" ? "Not drafted yet. Draft the narrative with AI, or write it here." : undefined}
        aria-invalid={tooLong || undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="min-h-20 bg-background text-sm"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {hint ? <span id={`${id}-hint`}>{hint}</span> : null}
        {save.isPending ? (
          <span className="flex items-center gap-1" role="status">
            <LoaderCircleIcon className="size-3 animate-spin" aria-hidden />
            Saving…
          </span>
        ) : save.isError ? (
          <span role="alert" className="flex items-center gap-2 text-destructive">
            Not saved: {save.error.message}
            <Button variant="outline" size="xs" onClick={submit}>
              Retry
            </Button>
          </span>
        ) : save.isSuccess && !dirty ? (
          <span role="status">Saved</span>
        ) : null}
        {reset.isError ? <span role="alert" className="text-destructive">Reset failed: {reset.error.message}</span> : null}
        {tooLong ? <span className="text-destructive">At most {NARRATIVE_TEXT_MAX} characters.</span> : null}
      </div>
      {block.source === "EDITED" && block.aiText !== null && block.aiText !== block.text ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Show the AI draft</summary>
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted px-2.5 py-1.5">{block.aiText}</p>
        </details>
      ) : null}
      <GuardWarnings warnings={warnings} />
    </div>
  );
}
