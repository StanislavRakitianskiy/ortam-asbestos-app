import { PrismaClient } from "@prisma/client";
import { getEnv } from "@/server/env";

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Lazily creates the Prisma client after the environment has been validated. */
export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    getEnv();
    globalForPrisma.prisma = new PrismaClient();
  }
  return globalForPrisma.prisma;
}
