import { copyFile, rm, unlink } from "node:fs/promises";
import { basename } from "node:path";
import { ImageSlimError } from "../errors/image-slim-error";

export interface OriginalsFileSystem {
  copyFile: typeof copyFile;
  unlink: typeof unlink;
  rm: typeof rm;
}

const nodeFileSystem: OriginalsFileSystem = { copyFile, unlink, rm };

/**
 * Remove source files as the final step of a destructive migration.
 *
 * Every source is backed up in place before the first deletion, so a failure
 * at any point restores the originals, rolls back the reference transaction,
 * and leaves the caller with either the original tree or a recoverable backup.
 */
export async function removeOriginalsSafely(
  transformations: Array<{ sourcePath: string }>,
  rollbackReferences: () => Promise<void>,
  system: OriginalsFileSystem = nodeFileSystem,
): Promise<void> {
  const backups: Array<{ sourcePath: string; backupPath: string }> = [];
  try {
    for (const [index, transformation] of transformations.entries()) {
      const backupPath = `${transformation.sourcePath}.${basename(transformation.sourcePath)}.${process.pid}.${Date.now()}.${index}.backup`;
      await system.copyFile(transformation.sourcePath, backupPath);
      backups.push({ sourcePath: transformation.sourcePath, backupPath });
    }
    for (const transformation of transformations) {
      await system.unlink(transformation.sourcePath);
    }
  } catch (error) {
    const restored: string[] = [];
    for (const backup of backups) {
      try {
        await system.copyFile(backup.backupPath, backup.sourcePath);
        restored.push(backup.backupPath);
      } catch {
        // Keep this backup on disk: it is the only remaining copy.
      }
    }
    await rollbackReferences();
    await Promise.all(
      restored.map((backupPath) =>
        system.rm(backupPath, { force: true }).catch(() => undefined),
      ),
    );
    throw new ImageSlimError(
      "REFERENCE_UPDATE_FAILED",
      "Unable to remove originals safely; changes were rolled back.",
      { cause: error },
    );
  }
  await Promise.all(
    backups.map((backup) =>
      system.rm(backup.backupPath, { force: true }).catch(() => undefined),
    ),
  );
}
