import { connection } from "next/server";
import { projectUpdateSchema } from "@/domain/projectInput";
import { handle, json, noContent, parseBody } from "@/server/http";
import { projectService } from "@/server/services/projectService";

type Context = RouteContext<"/api/projects/[id]">;

export const GET = handle(async (_request: Request, { params }: Context) => {
  await connection();
  const { id } = await params;
  return json(await projectService().get(id));
});

export const PATCH = handle(async (request: Request, { params }: Context) => {
  const { id } = await params;
  const patch = await parseBody(request, projectUpdateSchema);
  return json(await projectService().update(id, patch));
});

export const DELETE = handle(async (_request: Request, { params }: Context) => {
  const { id } = await params;
  await projectService().remove(id);
  return noContent();
});
