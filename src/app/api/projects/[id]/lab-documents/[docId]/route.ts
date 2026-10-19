import { labReportIdInputSchema } from "@/domain/labReviewInput";
import { handle, json, parseBody } from "@/server/http";
import { labDocumentService } from "@/server/services/labDocumentService";
import { labReviewService } from "@/server/services/labReviewService";

type Context = RouteContext<"/api/projects/[id]/lab-documents/[docId]">;

export const GET = handle(async (_request: Request, { params }: Context) => {
  const { id, docId } = await params;
  return json(await labDocumentService().get(id, docId));
});

/** Enters or corrects the lab report ID, with a reason. */
export const PATCH = handle(async (request: Request, { params }: Context) => {
  const { id, docId } = await params;
  const body = await parseBody(request, labReportIdInputSchema);
  return json(await labReviewService().setLabReportId(id, docId, body));
});
