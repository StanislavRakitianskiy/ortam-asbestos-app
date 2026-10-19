import { narrativeEditSchema } from "@/domain/narrative";
import { handle, json, parseBody } from "@/server/http";
import { narrativeService } from "@/server/services/narrativeService";

/** Saves the employee's text of one narrative slot. Answers with the updated report draft. */
export const PUT = handle(async (request: Request, { params }: RouteContext<"/api/projects/[id]/report/narrative">) => {
  const { id } = await params;
  const body = await parseBody(request, narrativeEditSchema);
  return json(await narrativeService().save(id, body));
});
