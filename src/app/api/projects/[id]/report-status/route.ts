import { handle, json } from "@/server/http";
import { revisionService } from "@/server/services/revisionService";

/** Whether the latest ready revision still shows the current data: current | outdated | none | generating | failed. */
export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]/report-status">) => {
  const { id } = await params;
  return json(await revisionService().status(id));
});
