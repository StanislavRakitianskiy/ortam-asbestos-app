import { labResultDecisionSchema } from "@/domain/labReviewInput";
import { handle, json, parseBody } from "@/server/http";
import { labReviewService } from "@/server/services/labReviewService";

/** Accept, reject (with a reason) or reopen one row. */
export const POST = handle(
  async (request: Request, { params }: RouteContext<"/api/projects/[id]/lab-documents/[docId]/results/[resultId]/review">) => {
    const { id, docId, resultId } = await params;
    const body = await parseBody(request, labResultDecisionSchema);
    return json(await labReviewService().decide(id, docId, resultId, body));
  },
);
