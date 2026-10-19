import { handle } from "@/server/http";
import { labDocumentService } from "@/server/services/labDocumentService";

/** The uploaded PDF, for the source viewer. Content-addressed and never rewritten, so the browser may cache it. */
export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]/lab-documents/[docId]/file">) => {
  const { id, docId } = await params;
  const { fileName, bytes } = await labDocumentService().getFile(id, docId);
  return new Response(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
