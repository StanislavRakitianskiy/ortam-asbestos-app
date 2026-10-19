"use client";

import { useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, queryKeys } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";

type RawMessage = { content?: { type?: string; text?: string }[] };

/** The model's answer text pretty-printed when it is JSON; the stored response itself is never changed. */
function answerOf(rawResponse: string): string {
  try {
    const message = JSON.parse(rawResponse) as RawMessage;
    const text = (message.content ?? []).flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("");
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  } catch {
    return rawResponse;
  }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function RawResponseDialog({ projectId, runId, onClose }: { projectId: string; runId: string | null; onClose: () => void }) {
  const { data, error, isPending } = useQuery({
    queryKey: queryKeys.aiRun(projectId, runId ?? ""),
    queryFn: () => api.getAiRun(projectId, runId ?? ""),
    enabled: runId !== null,
    staleTime: Infinity,
  });

  return (
    <Dialog open={runId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Raw AI response</DialogTitle>
          <DialogDescription>
            {data
              ? `${data.model} · ${data.promptVersion} · ${data.status.toLowerCase()} · ${formatDateTime(data.createdAt)}${
                  data.responseId ? ` · ${data.responseId}` : ""
                }`
              : "Exactly what the model returned, before verification and review."}
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            Loading…
          </p>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load the AI response: {error.message}
          </p>
        ) : data.rawResponse === null ? (
          <p className="text-sm text-muted-foreground">No response was received{data.error ? `: ${data.error}` : "."}</p>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            {data.error ? <p className="text-destructive">{data.error}</p> : null}
            <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
              {answerOf(data.rawResponse)}
            </pre>
            <details>
              <summary className="cursor-pointer text-muted-foreground">Full API response (stop reason {data.stopReason ?? "unknown"})</summary>
              <pre className="mt-2 max-h-[40vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                {prettyJson(data.rawResponse)}
              </pre>
            </details>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
