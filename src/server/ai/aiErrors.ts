import Anthropic from "@anthropic-ai/sdk";

/** Why an AI step failed. Stored as LabDocument.errorCode; the UI offers Retry when `retryable` is true. */
export const AI_ERROR_CODES = [
  "NO_API_KEY",
  "AUTH",
  "MODEL_NOT_FOUND",
  "RATE_LIMIT",
  "OVERLOADED",
  "TIMEOUT",
  "CONNECTION",
  "BAD_REQUEST",
  "REFUSED",
  "INVALID_RESPONSE",
  "INTERRUPTED",
  "UNKNOWN",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Failure that is not about the AI: the PDF has no text layer. Retrying cannot help. */
export const NO_TEXT_CODE = "NO_TEXT";
export const NO_TEXT_MESSAGE = "No selectable text found (scanned PDFs are out of scope).";

export type AiFailure = { code: AiErrorCode; message: string };

/** Anything shaped like an Anthropic key is cut out of text before it is stored or shown. */
export function redactSecrets(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted key]");
}

const KEY_HINT = "Check ANTHROPIC_API_KEY in .env.local and restart the server (npm run dev).";

/** Turns an SDK or network error into a message the employee can act on. Never includes the API key. */
export function describeAiError(error: unknown, model: string, timeoutSeconds: number): AiFailure {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return { code: "TIMEOUT", message: `The AI service did not answer within ${timeoutSeconds} seconds. Retry in a moment.` };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { code: "CONNECTION", message: "Cannot reach the Anthropic API. Check the internet connection, then retry." };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return { code: "AUTH", message: `The Anthropic API rejected the API key (HTTP 401). ${KEY_HINT}` };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { code: "AUTH", message: `This API key is not allowed to use the requested model (HTTP 403). ${KEY_HINT}` };
  }
  if (error instanceof Anthropic.NotFoundError) {
    return { code: "MODEL_NOT_FOUND", message: `The model "${model}" is not available for this API key. Check ANTHROPIC_MODEL in .env.local.` };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { code: "RATE_LIMIT", message: "The Anthropic API rate limit was reached. Wait a minute, then retry." };
  }
  if (error instanceof Anthropic.InternalServerError) {
    return error.status === 529
      ? { code: "OVERLOADED", message: "The AI service is overloaded right now (HTTP 529). Retry in a moment." }
      : { code: "OVERLOADED", message: `The AI service had an internal error (HTTP ${error.status}). Retry in a moment.` };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { code: "BAD_REQUEST", message: `The AI service rejected the request: ${redactSecrets(apiMessage(error))}` };
  }
  if (error instanceof Anthropic.APIError) {
    return { code: "UNKNOWN", message: `The AI service answered with an error (HTTP ${error.status ?? "unknown"}). Retry in a moment.` };
  }
  return { code: "UNKNOWN", message: "The AI step failed unexpectedly. Retry; if it fails again, check the server log." };
}

/** The API's own error text without the HTTP status prefix the SDK adds. */
function apiMessage(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  return typeof body?.error?.message === "string" ? body.error.message : error.message;
}
