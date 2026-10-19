import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicKeyStatus } from "@/server/env";
import type { PageText } from "@/server/pdf/extractPages";
import { describeAiError, redactSecrets, type AiFailure } from "@/server/ai/aiErrors";
import { labExtractionJsonSchema } from "@/server/ai/labExtractionSchema";
import {
  buildRetryNote,
  buildUserContent,
  EFFORT,
  MAX_TOKENS,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from "@/server/ai/prompts/labExtraction.v2";
import { parseExtraction, type ParsedExtraction } from "@/server/ai/verifyExtraction";

export type ExtractionRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type ExtractionResponse = Anthropic.Beta.Messages.BetaMessage;
/** One model call. The app always uses anthropicSender(); tests pass a fake. */
export type SendMessage = (request: ExtractionRequest) => Promise<ExtractionResponse>;

export const REQUEST_TIMEOUT_SECONDS = 90;
/** The SDK retries 408/409/429/5xx and connection errors itself; one AiRun covers those retries. */
const SDK_MAX_RETRIES = 2;
/** One automatic retry when the answer is unusable (not JSON, wrong shape, cut off). */
const MAX_ATTEMPTS = 2;
/** Server-side fallback when the model declines for policy reasons (D-017). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

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

export type ExtractLabReportDeps = {
  model: string;
  keyStatus: AnthropicKeyStatus;
  send: SendMessage;
  runLog: RunLog;
  now?: () => number;
};

export type ExtractionOutcome =
  | { ok: true; runId: string; model: string; extraction: ParsedExtraction }
  | { ok: false; runId: string; failure: AiFailure };

export function buildExtractionRequest(pages: readonly PageText[], model: string, problems: readonly string[] = []): ExtractionRequest {
  const content = buildUserContent(pages);
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: problems.length === 0 ? content : `${content}\n\n${buildRetryNote(problems)}` }],
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: labExtractionJsonSchema() } },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
  };
}

type Reading = { ok: true; extraction: ParsedExtraction } | { ok: false; refused: boolean; problems: string[] };

/** The answer text: text blocks after the last fallback switch, i.e. from the model that finished the turn. */
function answerText(response: ExtractionResponse): string {
  const lastSwitch = response.content.findLastIndex((block) => block.type === "fallback");
  return response.content
    .slice(lastSwitch + 1)
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

function readResponse(response: ExtractionResponse): Reading {
  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category;
    return { ok: false, refused: true, problems: [`The model declined to process this document${category ? ` (${category})` : ""}.`] };
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
  const parsed = parseExtraction(json);
  return parsed.ok ? { ok: true, extraction: parsed.value } : { ok: false, refused: false, problems: parsed.issues };
}

function totalInputTokens(usage: ExtractionResponse["usage"]): number {
  return usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

/**
 * Extracts lab results from page texts with one structured-output call, plus one retry when the answer cannot be
 * used. Every call is recorded through runLog. The result is a draft: evidence is checked afterwards by
 * verifyExtraction(), and nothing here interprets results, applies thresholds or computes costs.
 */
export async function extractLabReport(pages: readonly PageText[], deps: ExtractLabReportDeps): Promise<ExtractionOutcome> {
  const now = deps.now ?? Date.now;
  const meta = { model: deps.model, promptVersion: PROMPT_VERSION };

  if (!deps.keyStatus.configured) {
    const runId = await deps.runLog.start(meta);
    const failure: AiFailure = {
      code: "NO_API_KEY",
      message: `The AI extraction cannot run: ${deps.keyStatus.message} Add the key to .env.local and restart the server (npm run dev).`,
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
    let response: ExtractionResponse;
    try {
      response = await deps.send(buildExtractionRequest(pages, deps.model, problems));
    } catch (error) {
      const failure = describeAiError(error, deps.model, REQUEST_TIMEOUT_SECONDS);
      await deps.runLog.finish(runId, { ...emptyRecord(deps.model, failure.message), durationMs: now() - started });
      return { ok: false, runId, failure };
    }

    const reading = readResponse(response);
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

    if (reading.ok) return { ok: true, runId, model: response.model, extraction: reading.extraction };
    if (reading.refused) return { ok: false, runId, failure: { code: "REFUSED", message: `${reading.problems[0]} Retry, or enter the results manually.` } };
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
