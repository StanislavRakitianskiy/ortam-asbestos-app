"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NarrativeEditInput, NarrativeResetInput } from "@/domain/narrative";
import type { ReviewChecklistInput } from "@/domain/reviewChecklist";
import { api, queryKeys } from "@/lib/api";
import type { ReportDraftDto } from "@/server/services/reportService";

const POLL_MS = 3000;

/** The report draft. Polls while an AI draft started elsewhere (another tab) is still running. */
export function useReport(projectId: string) {
  return useQuery({
    queryKey: queryKeys.report(projectId),
    queryFn: () => api.getReport(projectId),
    refetchInterval: (query) => (query.state.data?.draft.running ? POLL_MS : false),
  });
}

/** Puts the report a call returned into the cache and refreshes the project's "Last saved". */
function useApplyReport(projectId: string) {
  const queryClient = useQueryClient();
  return (report: ReportDraftDto) => {
    queryClient.setQueryData(queryKeys.report(projectId), report);
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId), exact: true });
  };
}

export function useDraftNarrative(projectId: string) {
  const apply = useApplyReport(projectId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.draftNarrative(projectId),
    onSuccess: (result) => apply(result.report),
    // The failed run is now the last run: show it.
    onError: () => void queryClient.invalidateQueries({ queryKey: queryKeys.report(projectId) }),
  });
}

export function useSaveNarrative(projectId: string) {
  const apply = useApplyReport(projectId);
  return useMutation({ mutationFn: (input: NarrativeEditInput) => api.saveNarrative(projectId, input), onSuccess: apply });
}

export function useResetNarrative(projectId: string) {
  const apply = useApplyReport(projectId);
  return useMutation({ mutationFn: (input: NarrativeResetInput) => api.resetNarrative(projectId, input), onSuccess: apply });
}

export function useSaveChecklist(projectId: string) {
  const apply = useApplyReport(projectId);
  return useMutation({ mutationFn: (input: ReviewChecklistInput) => api.saveChecklist(projectId, input), onSuccess: apply });
}
