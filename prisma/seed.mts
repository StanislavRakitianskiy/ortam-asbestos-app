// Dev-only demo data, run with `npm run db:seed`. Executed by Node's built-in TypeScript support,
// so keep to erasable syntax and avoid the @/ alias here.
// Phase 0 only has the Project model; the demo project from the field notes is added with the phase 2 schema.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const project = await prisma.project.upsert({
    where: { code: "DEMO" },
    update: {},
    create: { code: "DEMO" },
  });
  console.log(`Seeded project ${project.code} (${project.id}).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
