import { handle, json } from "@/server/http";
import { reportService } from "@/server/services/reportService";

/** The report draft: the report model from the current data, guardrail warnings and the state of the AI draft. */
export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]/report">) => {
  const { id } = await params;
  return json(await reportService().get(id));
});
