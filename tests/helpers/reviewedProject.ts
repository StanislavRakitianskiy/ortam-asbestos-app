import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { expect } from "vitest";
import { zoneCreateSchema } from "@/domain/projectInput";
import { labDocumentService, type UploadFile } from "@/server/services/labDocumentService";
import { labReviewService } from "@/server/services/labReviewService";
import { projectService } from "@/server/services/projectService";
import { demoZones } from "../fixtures/demoProject";
import { configuredKey, fakeMessage, loadAiFixture, scriptedSender } from "./fakeAi";

/** A lab PDF and the AI answer (tests/fixtures/ai/<answer>.json) that is replayed for it. */
export type LabFile = { path: string; answer: string };

export const SUPPLIED_LAB_FILES: LabFile[] = [
  { path: "fixtures/LAB-A_fictional_lab_report.pdf", answer: "lab-a.recorded" },
  { path: "fixtures/LAB-B_fictional_lab_report.pdf", answer: "lab-b.recorded" },
  { path: "fixtures/LAB-C_fictional_lab_report.pdf", answer: "lab-c.recorded" },
];

/** Candidate-made test fixture (scripts/make-edge-fixture.ts) with a hand-written AI answer. */
export const LAB_X_FILE: LabFile = { path: "fixtures/test/LAB-X_edge_cases.pdf", answer: "lab-x.handwritten" };

/**
 * A project with the supplied material register and the given lab reports uploaded, extracted with the recorded AI
 * answers and accepted through "Accept all verified". Returns the document IDs by answer name.
 */
export async function createReviewedProject(
  db: PrismaClient,
  storageDir: string,
  code: string,
  files: readonly LabFile[],
): Promise<{ projectId: string; documentIds: Record<string, string> }> {
  const project = await db.project.create({ data: { code, client: "Example Property Group fictional", building: "Fictional Training Building A" } });
  for (const zone of demoZones()) {
    const { materialId, description, floor, location, sampleIds, quantity, unit, condition, plannedDisturbance, rateRef, accessible, notes } = zone;
    const input = { materialId, description, floor, location, sampleIds, quantity, unit, condition, plannedDisturbance, rateRef, accessible, notes };
    await projectService(db).addZone(project.id, zoneCreateSchema.parse(input));
  }

  const review = labReviewService(db);
  const documentIds: Record<string, string> = {};
  for (const file of files) {
    const bytes = new Uint8Array(await readFile(file.path));
    const queue: (() => Promise<void>)[] = [];
    const documents = labDocumentService({
      db,
      storageDir,
      extraction: () => ({
        model: "claude-test-model",
        keyStatus: configuredKey,
        send: scriptedSender(fakeMessage(JSON.stringify(loadAiFixture(file.answer).output))),
      }),
      schedule: (task) => queue.push(task),
    });
    const upload: UploadFile = { name: path.basename(file.path), type: "application/pdf", size: bytes.byteLength, read: async () => bytes };
    const [outcome] = await documents.upload(project.id, [upload]);
    if (outcome.outcome !== "created") throw new Error(`upload of ${file.path} failed`);
    while (queue.length > 0) await queue.shift()!();
    const { document } = await review.acceptVerified(project.id, outcome.document.id);
    // Every row of the recorded answers is verified against the PDF text, so the whole report is accepted.
    expect(document.status, file.path).toBe("ACCEPTED");
    documentIds[file.answer] = document.id;
  }
  return { projectId: project.id, documentIds };
}
