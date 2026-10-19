import { getDb } from "@/server/db";
import { describeAnthropicKey, EnvError, getEnv, type AnthropicKeyStatus, type AppEnv } from "@/server/env";

export type CheckResult = { ok: boolean; message: string };

export type HealthReport = {
  ok: boolean;
  /** Set when the environment itself is invalid; the checks below then explain what is blocked. */
  configError: string | null;
  checks: {
    database: CheckResult;
    pdfConverter: CheckResult;
    anthropicKey: AnthropicKeyStatus;
  };
};

export type HealthDeps = {
  env: () => AppEnv;
  countProjects: () => Promise<number>;
  fetch: typeof fetch;
};

const defaultDeps: HealthDeps = {
  env: getEnv,
  countProjects: () => getDb().project.count(),
  fetch: (...args) => fetch(...args),
};

const PDF_CONVERTER_TIMEOUT_MS = 3000;

function lastLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? "Unknown error";
}

async function checkDatabase(countProjects: HealthDeps["countProjects"]): Promise<CheckResult> {
  try {
    await countProjects();
    return { ok: true, message: "SQLite is reachable and migrations are applied." };
  } catch (error) {
    return {
      ok: false,
      message: `Cannot query the database (${lastLine(error)}). Run npm run setup and check DATABASE_URL.`,
    };
  }
}

async function checkPdfConverter(baseUrl: string, fetchImpl: HealthDeps["fetch"]): Promise<CheckResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/health`;
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(PDF_CONVERTER_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, message: `Gotenberg answered HTTP ${response.status} at ${url}.` };
    }
    return { ok: true, message: `Gotenberg is up at ${baseUrl}.` };
  } catch {
    return { ok: false, message: `Cannot reach Gotenberg at ${url}. Start it with docker compose up -d.` };
  }
}

export async function getHealthReport(deps: HealthDeps = defaultDeps): Promise<HealthReport> {
  let env: AppEnv;
  try {
    env = deps.env();
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    const blocked: CheckResult = { ok: false, message: "Not checked: fix the environment configuration first." };
    return {
      ok: false,
      configError: error.message,
      checks: {
        database: blocked,
        pdfConverter: blocked,
        anthropicKey: { configured: false, message: blocked.message },
      },
    };
  }

  const [database, pdfConverter] = await Promise.all([
    checkDatabase(deps.countProjects),
    checkPdfConverter(env.GOTENBERG_URL, deps.fetch),
  ]);
  const anthropicKey = describeAnthropicKey(env);

  return {
    ok: database.ok && pdfConverter.ok && anthropicKey.configured,
    configError: null,
    checks: { database, pdfConverter, anthropicKey },
  };
}
