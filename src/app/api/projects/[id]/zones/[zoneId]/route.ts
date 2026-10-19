import { zoneUpdateSchema } from "@/domain/projectInput";
import { handle, json, noContent, parseBody } from "@/server/http";
import { projectService } from "@/server/services/projectService";

type Context = RouteContext<"/api/projects/[id]/zones/[zoneId]">;

export const PATCH = handle(async (request: Request, { params }: Context) => {
  const { id, zoneId } = await params;
  const patch = await parseBody(request, zoneUpdateSchema);
  return json(await projectService().updateZone(id, zoneId, patch));
});

export const DELETE = handle(async (_request: Request, { params }: Context) => {
  const { id, zoneId } = await params;
  await projectService().removeZone(id, zoneId);
  return noContent();
});
