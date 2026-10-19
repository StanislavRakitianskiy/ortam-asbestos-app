import { issueReopenInputSchema, issueResolutionInputSchema } from "@/domain/issueResolution";
import { handle, json, parseBody } from "@/server/http";
import { analysisService } from "@/server/services/analysisService";

type Context = RouteContext<"/api/projects/[id]/issue-resolutions">;

/** Resolve a blocking issue or keep it flagged in the draft, with a note. Answers with the updated analysis. */
export const PUT = handle(async (request: Request, { params }: Context) => {
  const { id } = await params;
  const body = await parseBody(request, issueResolutionInputSchema);
  return json(await analysisService().decide(id, body));
});

/** Remove a decision: the issue is open again, or an auto-cleared decision is dropped. */
export const DELETE = handle(async (request: Request, { params }: Context) => {
  const { id } = await params;
  const body = await parseBody(request, issueReopenInputSchema);
  return json(await analysisService().reopen(id, body));
});
