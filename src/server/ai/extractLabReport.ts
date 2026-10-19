import type { AiFailure } from "@/server/ai/aiErrors";
import { labExtractionJsonSchema } from "@/server/ai/labExtractionSchema";
import {
  buildRetryNote,
  buildUserContent,
  EFFORT,
  MAX_TOKENS,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from "@/server/ai/prompts/labExtraction.v2";
import { FALLBACK_BETA, runStructuredCall, type AiCallDeps, type AiRequest, type AiResponse } from "@/server/ai/structuredCall";
import { parseExtraction, type ParsedExtraction } from "@/server/ai/verifyExtraction";
import type { PageText } from "@/server/pdf/extractPages";

export { anthropicSender, REQUEST_TIMEOUT_SECONDS, type RunLog, type RunRecord, type SendMessage } from "@/server/ai/structuredCall";

export type ExtractionRequest = AiRequest;
export type ExtractionResponse = AiResponse;
export type ExtractLabReportDeps = AiCallDeps;

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

/**
 * Extracts lab results from page texts with one structured-output call, plus one retry when the answer cannot be
 * used. Every call is recorded through runLog. The result is a draft: evidence is checked afterwards by
 * verifyExtraction(), and nothing here interprets results, applies thresholds or computes costs.
 */
export async function extractLabReport(pages: readonly PageText[], deps: ExtractLabReportDeps): Promise<ExtractionOutcome> {
  const outcome = await runStructuredCall(
    {
      promptVersion: PROMPT_VERSION,
      stepName: "The AI extraction",
      refusalSubject: "process this document",
      refusalHint: "Retry, or enter the results manually.",
      buildRequest: (problems) => buildExtractionRequest(pages, deps.model, problems),
      parse: parseExtraction,
    },
    deps,
  );
  return outcome.ok ? { ok: true, runId: outcome.runId, model: outcome.model, extraction: outcome.value } : outcome;
}
