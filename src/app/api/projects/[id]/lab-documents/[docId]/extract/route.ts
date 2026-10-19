import { after } from "next/server";
import { z } from "zod";
import { handle, json, parseBody } from "@/server/http";
import { labDocumentService } from "@/server/services/labDocumentService";

const extractBodySchema = z.strictObject({ replaceReviewed: z.boolean().optional() });

/** Retry or re-extract. Answers 202 at once; the card follows the status by polling. */
export const POST = handle(
  async (request: Request, { params }: RouteContext<"/api/projects/[id]/lab-documents/[docId]/extract">) => {
    const { id, docId } = await params;
    const body = await parseBody(request, extractBodySchema);
    const document = await labDocumentService({ schedule: after }).startExtraction(id, docId, {
      replaceReviewed: body.replaceReviewed ?? false,
    });
    return json(document, 202);
  },
);
