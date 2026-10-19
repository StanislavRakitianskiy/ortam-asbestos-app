import { reviewChecklistInputSchema } from "@/domain/reviewChecklist";
import { handle, json, parseBody } from "@/server/http";
import { reportService } from "@/server/services/reportService";

/** Saves the employee review checklist with the reviewer and the day. Answers with the updated report draft. */
export const PUT = handle(async (request: Request, { params }: RouteContext<"/api/projects/[id]/report/checklist">) => {
  const { id } = await params;
  const body = await parseBody(request, reviewChecklistInputSchema);
  return json(await reportService().saveChecklist(id, body));
});
