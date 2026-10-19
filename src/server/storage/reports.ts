import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Paths relative to STORAGE_DIR, e.g. "reports/<projectId>/rev-3/report.pdf". */
export type RevisionFiles = { docxPath: string; pdfPath: string };

/** Folder of one revision, relative to STORAGE_DIR: reports/<projectId>/rev-<n>. */
export function revisionFolder(projectId: string, revisionNumber: number): string {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error("Not a project ID.");
  if (!Number.isSafeInteger(revisionNumber) || revisionNumber < 1) throw new Error("Not a revision number.");
  return path.posix.join("reports", projectId, `rev-${revisionNumber}`);
}

/**
 * Writes the Word and PDF files of a revision once. They are written read-only into a temporary folder that is then
 * renamed into place, so the revision folder appears complete or not at all; rename fails instead of replacing a
 * folder that already holds files.
 */
export async function saveRevisionFiles(
  storageDir: string,
  projectId: string,
  revisionNumber: number,
  files: { docx: Uint8Array; pdf: Uint8Array },
): Promise<RevisionFiles> {
  const folder = revisionFolder(projectId, revisionNumber);
  const target = path.resolve(storageDir, folder);
  const temp = path.resolve(storageDir, "reports", projectId, `.rev-${revisionNumber}-${randomUUID()}.tmp`);
  await mkdir(temp, { recursive: true });
  try {
    for (const [name, bytes] of [
      ["report.docx", files.docx],
      ["report.pdf", files.pdf],
    ] as const) {
      const file = path.join(temp, name);
      await writeFile(file, bytes, { flag: "wx" });
      await chmod(file, 0o444);
    }
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
  return { docxPath: path.posix.join(folder, "report.docx"), pdfPath: path.posix.join(folder, "report.pdf") };
}

/** Removes the folder of a revision whose generation failed after its files were written. */
export async function removeRevisionFiles(storageDir: string, projectId: string, revisionNumber: number): Promise<void> {
  await rm(path.resolve(storageDir, revisionFolder(projectId, revisionNumber)), { recursive: true, force: true });
}

export async function readRevisionFile(storageDir: string, relativePath: string): Promise<Uint8Array> {
  const root = path.resolve(storageDir, "reports");
  const file = path.resolve(storageDir, relativePath);
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error("Not a report file path.");
  return new Uint8Array(await readFile(file));
}
