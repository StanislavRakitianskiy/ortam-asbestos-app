import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

export type TestDb = { db: PrismaClient; cleanup: () => Promise<void> };

/**
 * A fresh SQLite file in the OS temp folder with all migrations applied. Each test file gets its own,
 * so files can run in parallel and prisma/dev.db is never touched.
 */
export function createTestDb(): TestDb {
  const dir = mkdtempSync(path.join(tmpdir(), "ortam-test-"));
  const url = `file:${path.join(dir, "test.db")}`;
  // DATABASE_URL from this environment wins over .env.local, which prisma.config.ts only loads as a fallback.
  execFileSync("npx", ["--no-install", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  const db = new PrismaClient({ datasourceUrl: url });
  return {
    db,
    async cleanup() {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
