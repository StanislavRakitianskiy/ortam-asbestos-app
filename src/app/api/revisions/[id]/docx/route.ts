import { fileResponse, handle } from "@/server/http";
import { revisionService } from "@/server/services/revisionService";

/** The Word file of a ready revision, e.g. ORTAM-DEMO-001_rev3.docx. */
export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/revisions/[id]/docx">) => {
  const { id } = await params;
  return fileResponse(await revisionService().getFile(id, "docx"), "attachment");
});
