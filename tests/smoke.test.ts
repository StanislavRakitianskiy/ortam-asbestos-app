import { readFileSync } from "node:fs";
import { parseEnv as parseDotenv } from "node:util";
import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/server/env";
import { getHealthReport, type HealthDeps } from "@/server/services/health";

const exampleEnv = parseDotenv(readFileSync(".env.example", "utf8"));

const healthyDeps = (overrides: Record<string, string>): HealthDeps => ({
  env: () => parseEnv({ ...exampleEnv, ...overrides }),
  countProjects: async () => 0,
  fetch: async () => Response.json({ status: "up" }),
});

describe("smoke: environment and health", () => {
  it("accepts the values documented in .env.example", () => {
    const env = parseEnv(exampleEnv);
    expect(env.DATABASE_URL).toBe("file:./dev.db");
    expect(env.GOTENBERG_URL).toBe("http://localhost:3001");
    expect(env.ANTHROPIC_MODEL).toBe("claude-sonnet-5-5");
    expect(env.STORAGE_DIR).toBe("./storage");
    // Compare a boolean so a failure never prints the secret.
    expect(env.ANTHROPIC_API_KEY === undefined, ".env.example must not contain an ANTHROPIC_API_KEY value").toBe(
      true,
    );
  });

  it("names every missing variable in a readable error", () => {
    let error: unknown;
    try {
      parseEnv({ ANTHROPIC_API_KEY: "" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EnvError);
    expect((error as EnvError).message).toContain("DATABASE_URL is missing");
    expect((error as EnvError).message).toContain("GOTENBERG_URL is missing");
    expect((error as EnvError).message).toContain("Copy .env.example to .env.local");
  });

  it("reports the Anthropic key only as configured or not, never its value", async () => {
    const fakeKey = "sk-ant-test-not-a-real-key";
    const report = await getHealthReport(healthyDeps({ ANTHROPIC_API_KEY: fakeKey }));
    expect(report.ok).toBe(true);
    expect(report.checks.anthropicKey.configured).toBe(true);
    expect(JSON.stringify(report)).not.toContain(fakeKey);

    const placeholder = await getHealthReport(healthyDeps({ ANTHROPIC_API_KEY: "// add key later" }));
    expect(placeholder.checks.anthropicKey.configured).toBe(false);
    expect(JSON.stringify(placeholder)).not.toContain("add key later");
  });

  it("marks an unreachable PDF converter as not reachable instead of failing", async () => {
    const report = await getHealthReport({
      ...healthyDeps({}),
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(report.ok).toBe(false);
    expect(report.checks.pdfConverter.ok).toBe(false);
    expect(report.checks.pdfConverter.message).toContain("docker compose up -d");
  });
});
