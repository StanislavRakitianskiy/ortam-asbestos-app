import { defineConfig } from "prisma/config";

// The Prisma CLI does not read .env.local (and skips .env once a config file exists),
// so load the same file Next.js uses. Values already set in the shell win.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local yet: rely on variables from the shell.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.mts",
  },
});
