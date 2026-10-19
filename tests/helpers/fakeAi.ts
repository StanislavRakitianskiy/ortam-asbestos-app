import { readFileSync } from "node:fs";
import type { ExtractionRequest, ExtractionResponse, RunLog, RunRecord, SendMessage } from "@/server/ai/extractLabReport";

/**
 * Test doubles for the Anthropic call. Only tests use these; the app always calls the real API.
 */

export type RecordedFixture = { _note: string; model: string; promptVersion: string; output: { results: Record<string, unknown>[] } & Record<string, unknown> };

export function loadAiFixture(name: string): RecordedFixture {
  return JSON.parse(readFileSync(`tests/fixtures/ai/${name}.json`, "utf8")) as RecordedFixture;
}

let counter = 0;

/** A Messages API response carrying `text` as the answer. Only the fields the extractor reads are realistic. */
export function fakeMessage(text: string, overrides: Record<string, unknown> = {}): ExtractionResponse {
  counter += 1;
  return {
    id: `msg_test_${counter}`,
    type: "message",
    role: "assistant",
    model: "claude-test-model",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    ...overrides,
  } as unknown as ExtractionResponse;
}

/** Replays the given answers (or throws the given errors) in order and remembers every request. */
export function scriptedSender(...answers: (ExtractionResponse | Error)[]): SendMessage & { requests: ExtractionRequest[] } {
  const requests: ExtractionRequest[] = [];
  const send = async (request: ExtractionRequest) => {
    requests.push(request);
    const answer = answers[Math.min(requests.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return Object.assign(send, { requests });
}

export type MemoryRun = { id: string; meta: { model: string; promptVersion: string }; record: RunRecord | null };

export function memoryRunLog(): RunLog & { runs: MemoryRun[] } {
  const runs: MemoryRun[] = [];
  return {
    runs,
    async start(meta) {
      const run = { id: `run_${runs.length + 1}`, meta, record: null };
      runs.push(run);
      return run.id;
    },
    async finish(runId, record) {
      const run = runs.find((candidate) => candidate.id === runId);
      if (run) run.record = record;
    },
  };
}

export const configuredKey = { configured: true, message: "ANTHROPIC_API_KEY is set." };
