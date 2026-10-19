import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Hex SHA-256 of the file content: the identity of an uploaded file. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Stored path relative to STORAGE_DIR, e.g. "uploads/<sha256>.pdf". */
export function uploadPath(sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Not a SHA-256 hex digest.");
  return path.posix.join("uploads", `${sha256}.pdf`);
}

const isAlreadyThere = (error: unknown) =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";

/**
 * Stores an uploaded PDF once, content-addressed and read-only. A file with the same hash is the same content,
 * so an existing file is never overwritten. The new file appears atomically: it is written under a temporary
 * name and then hard-linked into place, which (unlike rename) fails instead of replacing an existing file.
 */
export async function saveUpload(storageDir: string, bytes: Uint8Array, sha256: string): Promise<string> {
  const relative = uploadPath(sha256);
  const target = path.resolve(storageDir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    await chmod(temp, 0o444);
    await link(temp, target);
  } catch (error) {
    if (!isAlreadyThere(error)) throw error;
  } finally {
    await rm(temp, { force: true });
  }
  return relative;
}

export async function readUpload(storageDir: string, storagePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.resolve(storageDir, storagePath)));
}
