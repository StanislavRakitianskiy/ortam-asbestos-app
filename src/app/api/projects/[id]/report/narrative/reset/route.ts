import { narrativeResetSchema } from "@/domain/narrative";
import { handle, json, parseBody } from "@/server/http";
import { narrativeService } from "@/server/services/narrativeService";

/** Puts the AI draft back in place of the employee's text. Answers with the updated report draft. */
export const POST = handle(async (request: Request, { params }: RouteContext<"/api/projects/[id]/report/narrative/reset">) => {
  const { id } = await params;
  const body = await parseBody(request, narrativeResetSchema);
  return json(await narrativeService().reset(id, body));
});
