import { after } from "next/server";
import { ValidationError } from "@/server/errors";
import { handle, json } from "@/server/http";
import { labDocumentService, type UploadFile } from "@/server/services/labDocumentService";

export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/projects/[id]/lab-documents">) => {
  const { id } = await params;
  return json(await labDocumentService().list(id));
});

/** multipart/form-data with one or more PDFs in the "files" field. Extraction starts after the response. */
export const POST = handle(async (request: Request, { params }: RouteContext<"/api/projects/[id]/lab-documents">) => {
  const { id } = await params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ValidationError({}, ['Send the PDFs as multipart/form-data in the "files" field.']);
  }
  const files: UploadFile[] = form
    .getAll("files")
    .filter((entry): entry is File => typeof entry !== "string")
    .map((file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    }));
  return json(await labDocumentService({ schedule: after }).upload(id, files));
});
