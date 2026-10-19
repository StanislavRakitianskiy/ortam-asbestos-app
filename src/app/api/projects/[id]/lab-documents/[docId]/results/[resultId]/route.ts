import { labResultCorrectionSchema } from "@/domain/labReviewInput";
import { handle, json, parseBody } from "@/server/http";
import { labReviewService } from "@/server/services/labReviewService";

/** Corrects the current values of a row. A reason is required; the AI original is kept. */
export const PATCH = handle(
  async (request: Request, { params }: RouteContext<"/api/projects/[id]/lab-documents/[docId]/results/[resultId]">) => {
    const { id, docId, resultId } = await params;
    const body = await parseBody(request, labResultCorrectionSchema);
    return json(await labReviewService().correct(id, docId, resultId, body));
  },
);
