import { handle, json } from "@/server/http";
import { revisionService } from "@/server/services/revisionService";

/**
 * Generates a report revision from the current data and waits for it: snapshot → DOCX → PDF → stored files. Answers
 * 201 with the new revision, or 200 with the latest ready one when nothing changed since. A failed step answers 502
 * with a readable message; the revision is kept as FAILED and its files are never served.
 */
export const POST = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]/revisions">) => {
  const { id } = await params;
  const result = await revisionService().generate(id);
  return json(result, result.created ? 201 : 200);
});
