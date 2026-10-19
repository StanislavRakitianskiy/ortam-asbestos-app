import { connection } from "next/server";
import { projectCreateSchema } from "@/domain/projectInput";
import { handle, json, parseBody } from "@/server/http";
import { projectService } from "@/server/services/projectService";

export const GET = handle(async () => {
  await connection();
  return json(await projectService().list());
});

export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, projectCreateSchema);
  return json(await projectService().create(input), 201);
});
