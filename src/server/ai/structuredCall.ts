import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicKeyStatus } from "@/server/env";
import { describeAiError, redactSecrets, type AiFailure } from "@/server/ai/aiErrors";

/**
 * One structured-output request to Claude with the app's run log and retry rules, shared by the lab extraction and the
 * narrative draft (D-016, D-017, D-018): the answer is JSON for a json_schema format, parsed with zod by the caller;
 * an unusable answer gets one fresh retry with the problems appended; a refusal or an API error is not retried.
 */

export type AiRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type AiResponse = Anthropic.Beta.Messages.BetaMessage;
/** One model call. The app always uses anthropicSender(); tests pass a fake. */
export type SendMessage = (request: AiRequest) => Promise<AiResponse>;

export const REQUEST_TIMEOUT_SECONDS = 90;
/** The SDK retries 408/409/429/5xx and connection errors itself; one AiRun covers those retries. */
const SDK_MAX_RETRIES = 2;
/** One automatic retry when the answer is unusable (not JSON, wrong shape, cut off). */
const MAX_ATTEMPTS = 2;
/** Server-side fallback when the model declines for policy reasons (D-017). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function anthropicSender(apiKey: string): SendMessage {
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_SECONDS * 1000, maxRetries: SDK_MAX_RETRIES });
  return (request) => client.beta.messages.create(request);
}

export type RunRecord = {
  status: "SUCCEEDED" | "FAILED";
  /** The model that actually answered (a fallback model when the requested one declined). */
  model: string;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  stopReason: string | null;
  error: string | null;
  rawResponse: string | null;
};

/** Persists one AiRun per model call: started as RUNNING before the call, finished after it. */
export type RunLog = {
  start(meta: { model: string; promptVersion: string }): Promise<string>;
  finish(runId: string, record: RunRecord): Promise<void>;
};

export type AiCallDeps = {
  model: string;
  keyStatus: AnthropicKeyStatus;
  send: SendMessage;
  runLog: RunLog;
  now?: () => number;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

export type StructuredCall<T> = {
  promptVersion: string;
  /** "The AI extraction", for the message when no key is configured. */
  stepName: string;
  /** "process this document", for "The model declined to …". */
  refusalSubject: string;
  /** What the employee can do after a refusal, e.g. "Retry, or enter the results manually." */
  refusalHint: string;
  /** The request; problems is empty on the first attempt and lists what was wrong on the retry. */
  buildRequest: (problems: readonly string[]) => AiRequest;
  /** Shape and content checks of the answer JSON. */
  parse: (json: unknown) => ParseResult<T>;
};

export type CallOutcome<T> = { ok: true; runId: string; model: string; value: T } | { ok: false; runId: string; failure: AiFailure };

type Reading<T> = { ok: true; value: T } | { ok: false; refused: boolean; problems: string[] };

/** The answer text: text blocks after the last fallback switch, i.e. from the model that finished the turn. */
function answerText(response: AiResponse): string {
  const lastSwitch = response.content.findLastIndex((block) => block.type === "fallback");
  return response.content
    .slice(lastSwitch + 1)
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

function readResponse<T>(response: AiResponse, call: StructuredCall<T>): Reading<T> {
  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category;
    return { ok: false, refused: true, problems: [`The model declined to ${call.refusalSubject}${category ? ` (${category})` : ""}.`] };
  }
  if (response.stop_reason === "max_tokens") {
    return { ok: false, refused: false, problems: ["The answer was cut off at the output limit before the JSON was complete."] };
  }
  const text = answerText(response);
  if (text.trim() === "") return { ok: false, refused: false, problems: ["The answer contained no JSON text."] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, refused: false, problems: [`The answer is not valid JSON (${error instanceof Error ? error.message : "parse error"}).`] };
  }
  const parsed = call.parse(json);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, refused: false, problems: parsed.issues };
}

function totalInputTokens(usage: AiResponse["usage"]): number {
  return usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

function emptyRecord(model: string, error: string): RunRecord {
  return {
    status: "FAILED",
    model,
    responseId: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: 0,
    stopReason: null,
    error: redactSecrets(error),
    rawResponse: null,
  };
}

/** Runs the call with one retry for an unusable answer. Every model call is recorded through deps.runLog. */
export async function runStructuredCall<T>(call: StructuredCall<T>, deps: AiCallDeps): Promise<CallOutcome<T>> {
  const now = deps.now ?? Date.now;
  const meta = { model: deps.model, promptVersion: call.promptVersion };

  if (!deps.keyStatus.configured) {
    const runId = await deps.runLog.start(meta);
    const failure: AiFailure = {
      code: "NO_API_KEY",
      message: `${call.stepName} cannot run: ${deps.keyStatus.message} Add the key to .env.local and restart the server (npm run dev).`,
    };
    await deps.runLog.finish(runId, emptyRecord(deps.model, failure.message));
    return { ok: false, runId, failure };
  }

  let problems: string[] = [];
  let lastRunId = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const runId = await deps.runLog.start(meta);
    lastRunId = runId;
    const started = now();
    let response: AiResponse;
    try {
      response = await deps.send(call.buildRequest(problems));
    } catch (error) {
      const failure = describeAiError(error, deps.model, REQUEST_TIMEOUT_SECONDS);
      await deps.runLog.finish(runId, { ...emptyRecord(deps.model, failure.message), durationMs: now() - started });
      return { ok: false, runId, failure };
    }

    const reading = readResponse(response, call);
    await deps.runLog.finish(runId, {
      status: reading.ok ? "SUCCEEDED" : "FAILED",
      model: response.model,
      responseId: response.id,
      inputTokens: totalInputTokens(response.usage),
      outputTokens: response.usage.output_tokens,
      durationMs: now() - started,
      stopReason: response.stop_reason,
      error: reading.ok ? null : redactSecrets(reading.problems.join(" ")),
      rawResponse: JSON.stringify(response),
    });

    if (reading.ok) return { ok: true, runId, model: response.model, value: reading.value };
    if (reading.refused) return { ok: false, runId, failure: { code: "REFUSED", message: `${reading.problems[0]} ${call.refusalHint}` } };
    problems = reading.problems;
  }

  return {
    ok: false,
    runId: lastRunId,
    failure: {
      code: "INVALID_RESPONSE",
      message: `The AI response did not match the expected format, also after one automatic retry: ${problems[0] ?? "unknown problem"} Retry, or open the raw AI response.`,
    },
  };
}
