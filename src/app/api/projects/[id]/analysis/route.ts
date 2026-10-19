import { handle, json } from "@/server/http";
import { analysisService } from "@/server/services/analysisService";

/** Matching, categories, cost scenario, review issues and readiness, computed from the current data. */
export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]/analysis">) => {
  const { id } = await params;
  return json(await analysisService().get(id));
});
