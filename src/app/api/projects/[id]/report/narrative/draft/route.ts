import { handle, json } from "@/server/http";
import { narrativeService } from "@/server/services/narrativeService";

/**
 * Drafts the narrative with one AI call and waits for it (D-036). A failed call answers 502 with a readable message;
 * nothing is stored then.
 */
export const POST = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]/report/narrative/draft">) => {
  const { id } = await params;
  return json(await narrativeService().draft(id));
});
