"use client";

import { useState, type KeyboardEvent } from "react";
import { TriangleAlertIcon, XIcon } from "lucide-react";
import { splitSampleIds } from "@/domain/projectInput";

/**
 * Sample IDs as chips. Enter, comma, space, ";" or "|" add the typed text, so "S03|S07" from the field notes can be
 * pasted as is. The text still being typed is lifted to the parent (`draft`) so Save can include it.
 */
export function SampleIdInput({
  id,
  value,
  onChange,
  draft,
  onDraftChange,
  flagged,
  invalid,
  describedBy,
}: {
  id: string;
  value: string[];
  onChange: (ids: string[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  /** IDs to highlight, e.g. because another zone lists them too. */
  flagged: ReadonlySet<string>;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  function commit(text: string) {
    const added = splitSampleIds(text);
    if (added.length === 0) return;
    const repeated = added.filter((sampleId) => value.includes(sampleId));
    onChange([...value, ...added.filter((sampleId, index) => !value.includes(sampleId) && added.indexOf(sampleId) === index)]);
    onDraftChange("");
    setNotice(repeated.length > 0 ? `${repeated.join(", ")} is already in this zone.` : null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ",", ";", "|", " "].includes(event.key)) {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input px-1.5 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
        aria-invalid={invalid || undefined}
      >
        {value.map((sampleId) => {
          const isFlagged = flagged.has(sampleId);
          return (
            <span
              key={sampleId}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${
                isFlagged ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-muted text-foreground"
              }`}
            >
              {isFlagged ? <TriangleAlertIcon className="size-3" aria-label="Also in another zone" /> : null}
              {sampleId}
              <button
                type="button"
                className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label={`Remove ${sampleId}`}
                onClick={() => onChange(value.filter((other) => other !== sampleId))}
              >
                <XIcon className="size-3" aria-hidden />
              </button>
            </span>
          );
        })}
        <input
          id={id}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
          value={draft}
          placeholder={value.length === 0 ? "e.g. S01, then Enter" : "Add another"}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (!/[\s,;|]/.test(text)) return;
            event.preventDefault();
            commit(draft + text);
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoComplete="off"
        />
      </div>
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
    </div>
  );
}
