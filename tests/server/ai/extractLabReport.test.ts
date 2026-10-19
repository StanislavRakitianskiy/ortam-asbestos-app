import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { buildExtractionRequest, extractLabReport, type ExtractLabReportDeps } from "@/server/ai/extractLabReport";
import { PROMPT_VERSION } from "@/server/ai/prompts/labExtraction.v2";
import { extractPages, type PageText } from "@/server/pdf/extractPages";
import { configuredKey, fakeMessage, loadAiFixture, memoryRunLog, scriptedSender } from "../../helpers/fakeAi";

let pages: PageText[] = [];
const recorded = JSON.stringify(loadAiFixture("lab-a.recorded").output);

beforeAll(async () => {
  pages = (await extractPages(new Uint8Array(await readFile("fixtures/LAB-A_fictional_lab_report.pdf")))).pages;
});

function setup(...answers: Parameters<typeof scriptedSender>) {
  const send = scriptedSender(...answers);
  const runLog = memoryRunLog();
  let clock = 0;
  const deps: ExtractLabReportDeps = { model: "claude-test-model", keyStatus: configuredKey, send, runLog, now: () => (clock += 250) };
  return { send, runLog, deps };
}

const apiError = (status: number, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type: "api_error", message } }, message, new Headers());

describe("extractLabReport request", () => {
  it("sends the page text with the structured output schema, effort and server-side fallback", () => {
    const request = buildExtractionRequest(pages, "claude-test-model");
    expect(request.model).toBe("claude-test-model");
    expect(request.output_config?.effort).toBe("medium");
    expect(request.output_config?.format?.type).toBe("json_schema");
    expect(request.fallbacks).toBe("default");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(request.thinking).toBeUndefined();
    const content = request.messages[0].content as string;
    expect(content).toContain("=== PAGE 1 ===");
    expect(content).toContain("S02  Black adhesive  Detected  Chrysotile  2%");
    // Extraction must not depend on expectations: no zone register, no material IDs.
    expect(content).not.toMatch(/\bM0\d\b.*quantity|zone register/i);
  });
});

describe("extractLabReport", () => {
  it("returns the parsed extraction and records one successful run", async () => {
    const { deps, send, runLog } = setup(fakeMessage(recorded));
    const outcome = await extractLabReport(pages, deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.extraction.results).toHaveLength(4);
    expect(send.requests).toHaveLength(1);
    expect(runLog.runs).toHaveLength(1);
    expect(runLog.runs[0].meta).toEqual({ model: "claude-test-model", promptVersion: PROMPT_VERSION });
    expect(runLog.runs[0].record).toMatchObject({
      status: "SUCCEEDED",
      model: "claude-test-model",
      inputTokens: 1200,
      outputTokens: 300,
      durationMs: 250,
      stopReason: "end_turn",
      error: null,
    });
    expect(JSON.parse(runLog.runs[0].record?.rawResponse ?? "{}").content[0].text).toBe(recorded);
  });

  it("retries once with the validation problems when the answer has the wrong shape", async () => {
    const broken = JSON.stringify({ report: {}, results: [{ sampleId: "S01" }], documentNotes: [] });
    const { deps, send, runLog } = setup(fakeMessage(broken), fakeMessage(recorded));
    const outcome = await extractLabReport(pages, deps);

    expect(outcome.ok).toBe(true);
    expect(send.requests).toHaveLength(2);
    const retryText = send.requests[1].messages[0].content as string;
    expect(retryText).toContain("A previous answer to this request could not be used");
    expect(retryText).toContain("results.0.layer");
    expect(runLog.runs.map((run) => run.record?.status)).toEqual(["FAILED", "SUCCEEDED"]);
    // The unusable answer is kept for "View raw AI response".
    expect(runLog.runs[0].record?.rawResponse).toContain('"sampleId\\":\\"S01\\"');
  });

  it("fails after the one retry and never returns a partial result", async () => {
    const { deps, send, runLog } = setup(fakeMessage("not json"), fakeMessage("{ still not json"));
    const outcome = await extractLabReport(pages, deps);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.code).toBe("INVALID_RESPONSE");
    expect(outcome.failure.message).toContain("after one automatic retry");
    expect(send.requests).toHaveLength(2);
    expect(runLog.runs.map((run) => run.record?.status)).toEqual(["FAILED", "FAILED"]);
  });

  it("treats an answer cut off at max_tokens as unusable", async () => {
    const { deps, runLog } = setup(fakeMessage(recorded.slice(0, 200), { stop_reason: "max_tokens" }), fakeMessage(recorded));
    expect((await extractLabReport(pages, deps)).ok).toBe(true);
    expect(runLog.runs[0].record?.error).toContain("cut off");
  });

  it("reads the answer of the fallback model when the requested model declined", async () => {
    const response = fakeMessage(recorded, {
      model: "claude-fallback-model",
      content: [
        { type: "text", text: '{"partial":', citations: null },
        { type: "fallback", from: { model: "claude-test-model" }, to: { model: "claude-fallback-model" } },
        { type: "text", text: recorded, citations: null },
      ],
    });
    const { deps, runLog } = setup(response);
    const outcome = await extractLabReport(pages, deps);
    expect(outcome.ok && outcome.model).toBe("claude-fallback-model");
    expect(runLog.runs[0].record?.model).toBe("claude-fallback-model");
  });

  it("reports a refusal without retrying", async () => {
    const { deps, send } = setup(fakeMessage("", { stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } }));
    const outcome = await extractLabReport(pages, deps);
    expect(outcome.ok ? null : outcome.failure.code).toBe("REFUSED");
    expect(send.requests).toHaveLength(1);
  });

  it("does not call the API without a key, but records the failed attempt", async () => {
    const { deps, send, runLog } = setup(fakeMessage(recorded));
    const outcome = await extractLabReport(pages, { ...deps, keyStatus: { configured: false, message: "ANTHROPIC_API_KEY is not set in .env.local." } });
    expect(outcome.ok ? null : outcome.failure.code).toBe("NO_API_KEY");
    expect(outcome.ok ? "" : outcome.failure.message).toContain("ANTHROPIC_API_KEY is not set");
    expect(send.requests).toHaveLength(0);
    expect(runLog.runs[0].record?.status).toBe("FAILED");
  });

  it.each([
    [apiError(401, "invalid x-api-key"), "AUTH", "rejected the API key"],
    [apiError(404, "model: claude-test-model"), "MODEL_NOT_FOUND", "ANTHROPIC_MODEL"],
    [apiError(429, "rate limited"), "RATE_LIMIT", "rate limit"],
    [apiError(529, "Overloaded"), "OVERLOADED", "overloaded"],
    [apiError(500, "boom"), "OVERLOADED", "internal error"],
    [new Anthropic.APIConnectionTimeoutError(), "TIMEOUT", "did not answer within 90 seconds"],
    [new Anthropic.APIConnectionError({ message: "fetch failed" }), "CONNECTION", "Cannot reach"],
  ])("explains %s in plain words without retrying", async (error, code, text) => {
    const { deps, send, runLog } = setup(error);
    const outcome = await extractLabReport(pages, deps);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.code).toBe(code);
    expect(outcome.failure.message).toContain(text);
    expect(send.requests).toHaveLength(1);
    expect(runLog.runs[0].record).toMatchObject({ status: "FAILED", rawResponse: null, error: outcome.failure.message });
  });

  it("never stores an API key that appears in an error", async () => {
    const { deps, runLog } = setup(apiError(400, "bad header sk-ant-api03-secretvalue_123"));
    const outcome = await extractLabReport(pages, deps);
    expect(outcome.ok ? "" : outcome.failure.message).not.toContain("sk-ant-api03");
    expect(runLog.runs[0].record?.error).not.toContain("secretvalue");
    expect(runLog.runs[0].record?.error).toContain("[redacted key]");
  });
});
