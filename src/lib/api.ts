import type { ProjectCreateInput, ProjectUpdateInput, ZoneCreateInput, ZoneUpdateInput } from "@/domain/projectInput";
import type { MaterialZone } from "@/domain/types";
import type { ApiErrorBody } from "@/server/http";
import type { AiRunDetail, LabDocumentDto, UploadOutcome } from "@/server/services/labDocumentService";
import type { ProjectDetail, ProjectDto, ProjectSummary } from "@/server/services/projectService";

/** A failed API call with the server's readable message and, for HTTP 400, the invalid fields. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly fieldErrors: Record<string, string[]>;
  readonly formErrors: string[];

  constructor(status: number, body: Partial<ApiErrorBody> | null) {
    super(body?.error ?? `The server answered HTTP ${status}.`);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code;
    this.fieldErrors = body?.fieldErrors ?? {};
    this.formErrors = body?.formErrors ?? [];
  }
}

async function request<T>(url: string, init?: { method: string; body?: unknown }): Promise<T> {
  const body = init?.body;
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      // FormData sets its own multipart Content-Type with the boundary.
      headers: body === undefined || body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, { error: "Cannot reach the app server. Check that npm run dev is running, then retry." });
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data as Partial<ApiErrorBody> | null);
  return data as T;
}

export const queryKeys = {
  projects: ["projects"] as const,
  project: (projectId: string) => ["project", projectId] as const,
  labDocuments: (projectId: string) => ["project", projectId, "lab-documents"] as const,
  aiRun: (projectId: string, runId: string) => ["project", projectId, "ai-runs", runId] as const,
};

const projectUrl = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export const api = {
  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  createProject: (input: ProjectCreateInput) =>
    request<ProjectDto>("/api/projects", { method: "POST", body: input }),
  getProject: (projectId: string) => request<ProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`),
  updateProject: (projectId: string, patch: ProjectUpdateInput) =>
    request<ProjectDto>(`/api/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", body: patch }),
  deleteProject: (projectId: string) =>
    request<void>(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }),
  addZone: (projectId: string, input: ZoneCreateInput) =>
    request<MaterialZone>(`/api/projects/${encodeURIComponent(projectId)}/zones`, { method: "POST", body: input }),
  updateZone: (projectId: string, zoneId: string, patch: ZoneUpdateInput) =>
    request<MaterialZone>(`/api/projects/${encodeURIComponent(projectId)}/zones/${encodeURIComponent(zoneId)}`, {
      method: "PATCH",
      body: patch,
    }),
  deleteZone: (projectId: string, zoneId: string) =>
    request<void>(`/api/projects/${encodeURIComponent(projectId)}/zones/${encodeURIComponent(zoneId)}`, {
      method: "DELETE",
    }),
  listLabDocuments: (projectId: string) => request<LabDocumentDto[]>(`${projectUrl(projectId)}/lab-documents`),
  uploadLabDocuments: (projectId: string, files: readonly File[]) => {
    const form = new FormData();
    for (const file of files) form.append("files", file, file.name);
    return request<UploadOutcome[]>(`${projectUrl(projectId)}/lab-documents`, { method: "POST", body: form });
  },
  extractLabDocument: (projectId: string, documentId: string, replaceReviewed = false) =>
    request<LabDocumentDto>(`${projectUrl(projectId)}/lab-documents/${encodeURIComponent(documentId)}/extract`, {
      method: "POST",
      body: { replaceReviewed },
    }),
  getAiRun: (projectId: string, runId: string) =>
    request<AiRunDetail>(`${projectUrl(projectId)}/ai-runs/${encodeURIComponent(runId)}`),
};

/** First message per field, for showing next to inputs. */
export function firstFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(Object.entries(error.fieldErrors).map(([field, messages]) => [field, messages[0]]));
}
