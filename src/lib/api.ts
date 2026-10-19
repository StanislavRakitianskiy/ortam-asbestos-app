import type { ProjectCreateInput, ProjectUpdateInput, ZoneCreateInput, ZoneUpdateInput } from "@/domain/projectInput";
import type { MaterialZone } from "@/domain/types";
import type { ApiErrorBody } from "@/server/http";
import type { ProjectDetail, ProjectDto, ProjectSummary } from "@/server/services/projectService";

/** A failed API call with the server's readable message and, for HTTP 400, the invalid fields. */
export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string[]>;
  readonly formErrors: string[];

  constructor(status: number, body: Partial<ApiErrorBody> | null) {
    super(body?.error ?? `The server answered HTTP ${status}.`);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = body?.fieldErrors ?? {};
    this.formErrors = body?.formErrors ?? [];
  }
}

async function request<T>(url: string, init?: { method: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, { error: "Cannot reach the app server. Check that npm run dev is running, then retry." });
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body as Partial<ApiErrorBody> | null);
  return body as T;
}

export const queryKeys = {
  projects: ["projects"] as const,
  project: (projectId: string) => ["project", projectId] as const,
};

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
};

/** First message per field, for showing next to inputs. */
export function firstFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(Object.entries(error.fieldErrors).map(([field, messages]) => [field, messages[0]]));
}
