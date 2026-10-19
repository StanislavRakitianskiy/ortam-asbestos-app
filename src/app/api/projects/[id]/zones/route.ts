import { zoneCreateSchema } from "@/domain/projectInput";
import { handle, json, parseBody } from "@/server/http";
import { projectService } from "@/server/services/projectService";

export const POST = handle(async (request: Request, { params }: RouteContext<"/api/projects/[id]/zones">) => {
  const { id } = await params;
  const input = await parseBody(request, zoneCreateSchema);
  return json(await projectService().addZone(id, input), 201);
});
