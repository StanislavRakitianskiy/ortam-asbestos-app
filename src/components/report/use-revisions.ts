"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";

const POLL_MS = 2000;

/**
 * Whether the latest report revision still shows the current data. Data changes in other tabs, so it is read again
 * whenever the Preview view opens or the window gets focus, and polled while a revision is being generated elsewhere.
 */
export function useReportStatus(projectId: string) {
  return useQuery({
    queryKey: queryKeys.reportStatus(projectId),
    queryFn: () => api.getReportStatus(projectId),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.state === "generating" ? POLL_MS : false),
  });
}

export function useGenerateReport(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateReport(projectId),
    onSuccess: (result) => queryClient.setQueryData(queryKeys.reportStatus(projectId), result.status),
    // A failed attempt is stored as a FAILED revision: show it in the status and the history.
    onError: () => void queryClient.invalidateQueries({ queryKey: queryKeys.reportStatus(projectId) }),
  });
}
