"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { LabResultDecisionInput } from "@/domain/labReviewInput";
import { api, queryKeys } from "@/lib/api";
import type { LabDocumentDto } from "@/server/services/labDocumentDto";

/** Puts a document returned by a review call into the cached list and refreshes "Last saved" and the matching. */
export function useApplyDocument(projectId: string) {
  const queryClient = useQueryClient();
  return (document: LabDocumentDto) => {
    queryClient.setQueryData<LabDocumentDto[]>(queryKeys.labDocuments(projectId), (current) =>
      current?.map((item) => (item.id === document.id ? document : item)),
    );
    // exact: the lab documents query shares this key prefix and is already up to date.
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId), exact: true });
    void queryClient.invalidateQueries({ queryKey: queryKeys.analysis(projectId) });
  };
}

export type DecisionVariables = { documentId: string; resultId: string; input: LabResultDecisionInput };

/** Accept or reopen one row straight from the table or the source panel. Rejecting needs a reason (RejectDialog). */
export function useDecision(projectId: string) {
  const apply = useApplyDocument(projectId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, resultId, input }: DecisionVariables) => api.decideLabResult(projectId, documentId, resultId, input),
    onSuccess: apply,
    onError: (error) => {
      toast.error(`Not saved. ${error.message}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.labDocuments(projectId) });
    },
  });
}
