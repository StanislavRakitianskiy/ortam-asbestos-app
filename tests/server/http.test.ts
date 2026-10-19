import { describe, expect, it } from "vitest";
import { zoneCreateSchema } from "@/domain/projectInput";
import { NotFoundError, ValidationError } from "@/server/errors";
import { errorResponse, handle, parseBody, type ApiErrorBody } from "@/server/http";

const post = (body: string) => new Request("http://localhost/api/test", { method: "POST", body });

describe("API error responses", () => {
  it("answers 400 with the field names for invalid zone input", async () => {
    const route = handle(async (request: Request) => {
      await parseBody(request, zoneCreateSchema);
      return Response.json({});
    });
    const response = await route(post(JSON.stringify({ materialId: "M01", quantity: -1, unit: "sq m" })));
    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiErrorBody;
    expect(Object.keys(body.fieldErrors ?? {})).toEqual(
      expect.arrayContaining(["quantity", "unit", "description", "condition"]),
    );
    expect(body.error).toContain("quantity");
  });

  it("answers 400 for a body that is not JSON", async () => {
    const response = errorResponse(await parseBody(post("{"), zoneCreateSchema).catch((error: unknown) => error));
    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiErrorBody).formErrors).toEqual(["The request body must be valid JSON."]);
  });

  it("answers 404 for a missing record and a generic 500 for anything unexpected", async () => {
    expect(errorResponse(new NotFoundError("gone")).status).toBe(404);
    const crash = errorResponse(new Error("SQLITE_BUSY: database is locked at /secret/path"));
    expect(crash.status).toBe(500);
    expect(JSON.stringify(await crash.json())).not.toContain("/secret/path");
  });

  it("names the fields in the message of a ValidationError", () => {
    const error = new ValidationError({ materialId: ["is required"], unit: ["is invalid"] });
    expect(error.message).toBe("Please check: materialId is required; unit is invalid.");
  });
});
