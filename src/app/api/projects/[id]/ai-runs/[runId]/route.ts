import { handle, json } from "@/server/http";
import { labDocumentService } from "@/server/services/labDocumentService";

/** One AI call with its raw response, for "View raw AI response". */
export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]/ai-runs/[runId]">) => {
  const { id, runId } = await params;
  return json(await labDocumentService().getAiRun(id, runId));
});
