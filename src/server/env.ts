import { z } from "zod";

const ENV_FILE_HINT =
  "Copy .env.example to .env.local, fill in the values and restart the server (npm run dev).";

/** Treat `KEY=` (empty) the same as an unset variable so defaults and "missing" messages apply. */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const requiredText = (example: string) =>
  z.preprocess(
    blankToUndefined,
    z.string({ error: (issue) => (issue.input === undefined ? "is missing" : `must be text, e.g. ${example}`) }).trim(),
  );

const envSchema = z.object({
  DATABASE_URL: requiredText('"file:./dev.db"').refine((value) => value.startsWith("file:"), {
    error: 'must be a SQLite file URL, e.g. "file:./dev.db"',
  }),
  GOTENBERG_URL: requiredText("http://localhost:3001").pipe(
    z.url({ protocol: /^https?$/, error: "must be an http(s) URL, e.g. http://localhost:3001" }),
  ),
  ANTHROPIC_API_KEY: z.preprocess(blankToUndefined, z.string().trim().optional()),
  ANTHROPIC_MODEL: z.preprocess(blankToUndefined, z.string().trim().default("claude-sonnet-5-5")),
  STORAGE_DIR: z.preprocess(blankToUndefined, z.string().trim().default("./storage")),
});

export type AppEnv = z.infer<typeof envSchema>;

export class EnvError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      ["Environment configuration problem:", ...problems.map((problem) => `  - ${problem}`), ENV_FILE_HINT].join(
        "\n",
      ),
    );
    this.name = "EnvError";
    this.problems = problems;
  }
}

/** Validates raw environment variables. Throws EnvError with one readable line per problem. */
export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`));
  }
  return result.data;
}

let cached: AppEnv | undefined;

/** Validated server environment, parsed once per process. Server-only: never import from client code. */
export function getEnv(): AppEnv {
  cached ??= parseEnv(process.env);
  return cached;
}

export type AnthropicKeyStatus = { configured: boolean; message: string };

/**
 * Checks only that a key is present and shaped like an Anthropic API key (sk-ant-…).
 * It does not call the API, and the key value itself is never part of the result.
 */
export function describeAnthropicKey(env: Pick<AppEnv, "ANTHROPIC_API_KEY">): AnthropicKeyStatus {
  const key = env.ANTHROPIC_API_KEY;
  if (key === undefined) {
    return { configured: false, message: "ANTHROPIC_API_KEY is not set in .env.local." };
  }
  if (!/^sk-ant-[A-Za-z0-9_-]+$/.test(key)) {
    return {
      configured: false,
      message: "ANTHROPIC_API_KEY is set but does not look like an Anthropic API key (expected sk-ant-…).",
    };
  }
  return { configured: true, message: "ANTHROPIC_API_KEY is set." };
}
