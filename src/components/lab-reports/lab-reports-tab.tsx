"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LabDocumentCard } from "@/components/lab-reports/lab-document-card";
import { UploadDropzone } from "@/components/lab-reports/upload-dropzone";
import { api, queryKeys } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import type { LabDocumentDto, UploadOutcome } from "@/server/services/labDocumentService";

const POLL_MS = 2000;

const isBusy = (document: LabDocumentDto) => document.status === "UPLOADED" || document.status === "EXTRACTING";

/** The message shown when the same PDF is uploaded again. */
export function duplicateMessage(fileName: string, importedAt: string): string {
  // en-CA times end in "p.m." – drop that period so the sentence does not end in "..".
  const when = formatDateTime(importedAt).replace(/\.$/, "");
  return `${fileName} was already imported on ${when}. No duplicate findings were created.`;
}

export function useLabDocuments(projectId: string) {
  return useQuery({
    queryKey: queryKeys.labDocuments(projectId),
    queryFn: () => api.listLabDocuments(projectId),
    // Poll only while something is being extracted.
    refetchInterval: (query) => (query.state.data?.some(isBusy) ? POLL_MS : false),
  });
}

export function LabReportsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: documents, error, isPending, refetch } = useLabDocuments(projectId);
  /** Duplicate notices by document ID, shown on the card until dismissed. */
  const [notices, setNotices] = useState<Record<string, string>>({});

  const upload = useMutation({
    mutationFn: (files: File[]) => api.uploadLabDocuments(projectId, files),
    onSuccess: (outcomes: UploadOutcome[]) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.labDocuments(projectId) });
      const duplicates: Record<string, string> = {};
      for (const outcome of outcomes) {
        if (outcome.outcome === "created") toast.success(`${outcome.fileName} uploaded. Extracting results…`);
        if (outcome.outcome === "rejected") toast.error(`Not uploaded: ${outcome.error}`);
        if (outcome.outcome === "duplicate") {
          const message = duplicateMessage(outcome.fileName, outcome.document.createdAt);
          duplicates[outcome.document.id] = message;
          toast.info(message);
        }
      }
      setNotices((current) => ({ ...current, ...duplicates }));
    },
    onError: (uploadError) => toast.error(`Upload failed. ${uploadError.message}`),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Lab reports</CardTitle>
          <CardDescription>
            Upload the laboratory PDFs. The AI extracts every sample layer with its page and quoted line as a draft;
            each value is checked against the PDF text and must be reviewed before it is used.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadDropzone uploading={upload.isPending} onFiles={(files) => upload.mutate(files)} />
        </CardContent>
      </Card>

      {isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
          Loading lab reports…
        </p>
      ) : error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-destructive">Could not load the lab reports: {error.message}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lab reports uploaded yet.</p>
      ) : (
        documents.map((document) => (
          <LabDocumentCard
            key={document.id}
            projectId={projectId}
            document={document}
            notice={notices[document.id]}
            onDismissNotice={() =>
              setNotices((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== document.id)))
            }
          />
        ))
      )}
    </div>
  );
}
