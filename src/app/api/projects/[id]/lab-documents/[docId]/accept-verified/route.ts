import { handle, json } from "@/server/http";
import { labReviewService } from "@/server/services/labReviewService";

/** Accepts every pending row with verified evidence, confidence above low and no open flag. */
export const POST = handle(
  async (_request: Request, { params }: RouteContext<"/api/projects/[id]/lab-documents/[docId]/accept-verified">) => {
    const { id, docId } = await params;
    return json(await labReviewService().acceptVerified(id, docId));
  },
);
