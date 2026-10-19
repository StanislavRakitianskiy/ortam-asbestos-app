import type { NarrativeDraft } from "@/domain/narrative";
import { narrativeFacts, type NarrativeFacts } from "@/domain/narrativeFacts";
import type { ReportModel } from "@/domain/reportModel";
import { checkDraftStructure } from "@/domain/textGuards";
import type { AiFailure } from "@/server/ai/aiErrors";
import { narrativeJsonSchema, parseNarrativeDraft } from "@/server/ai/narrativeSchema";
import { buildRetryNote, buildUserContent, EFFORT, MAX_TOKENS, PROMPT_VERSION, SYSTEM_PROMPT } from "@/server/ai/prompts/narrative.v1";
import { FALLBACK_BETA, runStructuredCall, type AiCallDeps, type AiRequest, type ParseResult } from "@/server/ai/structuredCall";

export { PROMPT_VERSION as NARRATIVE_PROMPT_VERSION };

export type DraftNarrativeOutcome =
  | { ok: true; runId: string; model: string; draft: NarrativeDraft }
  | { ok: false; runId: string; failure: AiFailure };

export function buildNarrativeRequest(facts: NarrativeFacts, model: string, problems: readonly string[] = []): AiRequest {
  const content = buildUserContent(facts);
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: problems.length === 0 ? content : `${content}\n\n${buildRetryNote(problems)}` }],
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: narrativeJsonSchema() } },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
  };
}

/**
 * Drafts the report prose from the ReportModel's facts only (never the PDFs) with one structured-output call, plus one
 * retry when the answer is unusable: wrong shape, or an unknown, missing or duplicated zone, or a changed category.
 * The result is a draft for the employee; numbers, categories and costs stay in code, and the guardrails
 * (checkNarrative) run on it before it is shown.
 */
export async function draftNarrative(model: ReportModel, deps: AiCallDeps): Promise<DraftNarrativeOutcome> {
  const facts = narrativeFacts(model);
  const parse = (json: unknown): ParseResult<NarrativeDraft> => {
    const parsed = parseNarrativeDraft(json);
    if (!parsed.ok) return parsed;
    const problems = checkDraftStructure(model, parsed.value);
    return problems.length === 0 ? parsed : { ok: false, issues: problems };
  };
  const outcome = await runStructuredCall(
    {
      promptVersion: PROMPT_VERSION,
      stepName: "The AI narrative draft",
      refusalSubject: "draft this narrative",
      refusalHint: "Retry, or write the narrative by hand.",
      buildRequest: (problems) => buildNarrativeRequest(facts, deps.model, problems),
      parse,
    },
    deps,
  );
  return outcome.ok ? { ok: true, runId: outcome.runId, model: outcome.model, draft: outcome.value } : outcome;
}
