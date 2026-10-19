import { manualLabResultSchema } from "@/domain/labReviewInput";
import { handle, json, parseBody } from "@/server/http";
import { labReviewService } from "@/server/services/labReviewService";

/** Adds a row the AI missed, with its page and quoted line. */
export const POST = handle(
  async (request: Request, { params }: RouteContext<"/api/projects/[id]/lab-documents/[docId]/results">) => {
    const { id, docId } = await params;
    const body = await parseBody(request, manualLabResultSchema);
    return json(await labReviewService().addManual(id, docId, body), 201);
  },
);
