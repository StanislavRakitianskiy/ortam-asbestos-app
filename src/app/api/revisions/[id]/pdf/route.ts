import { fileResponse, handle } from "@/server/http";
import { revisionService } from "@/server/services/revisionService";

/** The PDF of a ready revision: a download, or `?inline=1` for the preview, which shows this exact file. */
export const GET = handle(async (request: Request, { params }: RouteContext<"/api/revisions/[id]/pdf">) => {
  const { id } = await params;
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return fileResponse(await revisionService().getFile(id, "pdf"), inline ? "inline" : "attachment");
});
