import type { z } from "zod";
import { AiStepError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";

/** JSON body of every non-2xx API response. */
export type ApiErrorBody = {
  error: string;
  /** Machine-readable reason for some 409 answers and the AI error code of a 502. */
  code?: string;
  fieldErrors?: Record<string, string[]>;
  formErrors?: string[];
};

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: NO_STORE });
}

/** Reads the request body as JSON and validates it. Throws ValidationError for bad JSON or bad fields. */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError({}, ["The request body must be valid JSON."]);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw ValidationError.fromZod(result.error);
  return result.data;
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ValidationError) {
    const body: ApiErrorBody = { error: error.message, fieldErrors: error.fieldErrors, formErrors: error.formErrors };
    return json(body, 400);
  }
  if (error instanceof NotFoundError) return json({ error: error.message } satisfies ApiErrorBody, 404);
  if (error instanceof ConflictError) return json({ error: error.message, code: error.code } satisfies ApiErrorBody, 409);
  if (error instanceof AiStepError) return json({ error: error.message, code: error.code } satisfies ApiErrorBody, 502);
  console.error(error);
  return json({ error: "Something went wrong on the server. Please try again." } satisfies ApiErrorBody, 500);
}

/** Wraps a route handler so known errors become readable JSON responses. */
export function handle<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
