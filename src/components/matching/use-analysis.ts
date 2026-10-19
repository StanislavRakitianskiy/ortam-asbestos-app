"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IssueReopenInput, IssueResolutionInput } from "@/domain/issueResolution";
import { api, queryKeys } from "@/lib/api";
import type { ProjectAnalysisDto } from "@/server/services/analysisService";

const POLL_MS = 2000;

/** The project's analysis. Polls while a lab report is being extracted, because its rows change what is matched. */
export function useAnalysis(projectId: string) {
  return useQuery({
    queryKey: queryKeys.analysis(projectId),
    queryFn: () => api.getAnalysis(projectId),
    refetchInterval: (query) =>
      query.state.data?.documents.some((document) => document.status === "UPLOADED" || document.status === "EXTRACTING") ? POLL_MS : false,
  });
}

/** Puts the analysis a decision call returned into the cache and refreshes the project's "Last saved". */
function useApplyAnalysis(projectId: string) {
  const queryClient = useQueryClient();
  return (analysis: ProjectAnalysisDto) => {
    queryClient.setQueryData(queryKeys.analysis(projectId), analysis);
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId), exact: true });
  };
}

export function useDecideIssue(projectId: string) {
  const apply = useApplyAnalysis(projectId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueResolutionInput) => api.decideIssue(projectId, input),
    onSuccess: apply,
    // The issue may have changed or gone: show the current list behind the error.
    onError: () => void queryClient.invalidateQueries({ queryKey: queryKeys.analysis(projectId) }),
  });
}

export function useReopenIssue(projectId: string) {
  const apply = useApplyAnalysis(projectId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueReopenInput) => api.reopenIssue(projectId, input),
    onSuccess: apply,
    onError: () => void queryClient.invalidateQueries({ queryKey: queryKeys.analysis(projectId) }),
  });
}
