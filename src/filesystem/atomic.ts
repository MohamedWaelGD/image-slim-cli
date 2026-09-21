import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, parse, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { ImageSlimError } from "../errors/image-slim-error";

function temporaryPath(path: string): string {
  return `${path}.${basename(path)}.${randomUUID()}.tmp`;
}

function backupPath(path: string): string {
  return `${path}.${basename(path)}.${randomUUID()}.bak`;
}

async function assertSafeParents(path: string): Promise<void> {
  const parent = resolve(dirname(path));
  const root = parse(parent).root;
  const parts = relative(root, parent).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new ImageSlimError(
          "OUTPUT_UNSAFE",
          `Refusing to write through a symbolic link: ${current}`,
        );
      }
    } catch (error) {
      if (error instanceof ImageSlimError) throw error;
      if (!isNotFound(error)) throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function replaceWithRollback(
  temporary: string,
  destination: string,
): Promise<void> {
  const backup = backupPath(destination);
  let movedExisting = false;
  let replacementSucceeded = false;

  try {
    try {
      await rename(destination, backup);
      movedExisting = true;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    try {
      await rename(temporary, destination);
      replacementSucceeded = true;
    } catch (error) {
      if (movedExisting) {
        try {
          await rename(backup, destination);
          movedExisting = false;
        } catch {
          // Preserve the original error; the backup remains available for recovery.
        }
      }
      throw error;
    }
  } finally {
    if (movedExisting && replacementSucceeded)
      await rm(backup, { force: true });
  }
}

export async function writeAtomic(
  path: string,
  data: Uint8Array,
  options: { overwrite?: boolean } = {},
): Promise<void> {
  await assertSafeParents(path);
  await mkdir(dirname(path), { recursive: true });
  const temporary = temporaryPath(path);
  try {
    await writeFile(temporary, data, { flag: "wx" });
    if (options.overwrite === false) {
      try {
        await link(temporary, path);
      } catch (error) {
        if (isAlreadyExists(error)) {
          throw new ImageSlimError(
            "OUTPUT_COLLISION",
            `Output already exists: ${path}`,
            { cause: error },
          );
        }
        throw error;
      }
      await rm(temporary, { force: true });
    } else {
      await replaceWithRollback(temporary, path);
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function copyAtomic(
  source: string,
  destination: string,
  options: { overwrite?: boolean } = {},
): Promise<void> {
  await assertSafeParents(destination);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = temporaryPath(destination);
  try {
    await copyFile(source, temporary);
    if (options.overwrite === false) {
      try {
        await link(temporary, destination);
      } catch (error) {
        if (isAlreadyExists(error)) {
          throw new ImageSlimError(
            "OUTPUT_COLLISION",
            `Output already exists: ${destination}`,
            { cause: error },
          );
        }
        throw error;
      }
      await rm(temporary, { force: true });
    } else {
      await replaceWithRollback(temporary, destination);
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function writeTextAtomic(
  path: string,
  content: string,
): Promise<void> {
  await writeAtomic(path, Buffer.from(content, "utf8"));
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}
