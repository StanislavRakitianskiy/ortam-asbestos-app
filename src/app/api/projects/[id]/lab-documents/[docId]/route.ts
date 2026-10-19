import { handle, json } from "@/server/http";
import { labDocumentService } from "@/server/services/labDocumentService";

export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]/lab-documents/[docId]">) => {
  const { id, docId } = await params;
  return json(await labDocumentService().get(id, docId));
});
