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
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { randomUUID } from "node:crypto";
import { ImageSlimError } from "../errors/image-slim-error";

/**
 * Subset of `node:fs/promises` used by the atomic helpers. Exposed so tests can
 * inject deterministic filesystem failures without mocking a Node builtin.
 */
export interface AtomicFileSystem {
  lstat: typeof lstat;
  mkdir: typeof mkdir;
  writeFile: typeof writeFile;
  rename: typeof rename;
  rm: typeof rm;
  link: typeof link;
  copyFile: typeof copyFile;
}

const nodeFileSystem: AtomicFileSystem = {
  lstat,
  mkdir,
  writeFile,
  rename,
  rm,
  link,
  copyFile,
};

export interface AtomicWriteOptions {
  overwrite?: boolean;
  /**
   * Topmost directory the caller is allowed to write into. Path components
   * strictly *below* this directory are checked for symbolic links. The
   * boundary itself is trusted because the caller selected it explicitly.
   */
  boundary?: string;
  system?: AtomicFileSystem;
}

function temporaryPath(path: string): string {
  return `${path}.${basename(path)}.${randomUUID()}.tmp`;
}

function backupPath(path: string): string {
  return `${path}.${basename(path)}.${randomUUID()}.bak`;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function assertNotSymlink(
  path: string,
  system: AtomicFileSystem,
  message: string,
): Promise<void> {
  try {
    if ((await system.lstat(path)).isSymbolicLink()) {
      throw new ImageSlimError("OUTPUT_UNSAFE", message);
    }
  } catch (error) {
    if (error instanceof ImageSlimError) throw error;
    if (!isNotFound(error)) throw error;
  }
}

/**
 * Reject writes that would traverse a symbolic link strictly below the
 * trusted boundary. Components above the boundary are not inspected so that
 * running inside a symlinked prefix (for example macOS `/tmp`) stays safe.
 */
async function assertSafeParents(
  path: string,
  boundary: string | undefined,
  system: AtomicFileSystem,
): Promise<void> {
  const parent = resolve(dirname(path));
  const checks: string[] = [];

  if (boundary === undefined) {
    checks.push(parent);
  } else {
    const root = resolve(boundary);
    const relativeParent = relative(root, parent);
    if (
      relativeParent === "" ||
      relativeParent === ".." ||
      relativeParent.startsWith(`..${sep}`) ||
      isAbsolute(relativeParent)
    ) {
      // Outside the trusted boundary: only the immediate parent is inspected.
      if (relativeParent !== "") checks.push(parent);
    } else {
      let current = root;
      for (const part of relativeParent.split(sep).filter(Boolean)) {
        current = resolve(current, part);
        checks.push(current);
      }
    }
  }

  for (const candidate of checks) {
    await assertNotSymlink(
      candidate,
      system,
      `Refusing to write through a symbolic link: ${candidate}`,
    );
  }
}

async function assertSafeDestination(
  path: string,
  system: AtomicFileSystem,
): Promise<void> {
  await assertNotSymlink(
    path,
    system,
    `Refusing to replace a symbolic link: ${path}`,
  );
}

async function replaceWithRollback(
  temporary: string,
  destination: string,
  system: AtomicFileSystem,
): Promise<void> {
  const backup = backupPath(destination);
  let movedExisting = false;
  let replacementSucceeded = false;

  try {
    try {
      await system.rename(destination, backup);
      movedExisting = true;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    try {
      await system.rename(temporary, destination);
      replacementSucceeded = true;
    } catch (error) {
      if (movedExisting) {
        try {
          await system.rename(backup, destination);
          movedExisting = false;
        } catch (restoreError) {
          throw new ImageSlimError(
            "OUTPUT_UNSAFE",
            `Replacement failed and the original could not be restored. A recoverable backup was preserved at ${backup}.`,
            { cause: restoreError },
          );
        }
      }
      throw error;
    }
  } finally {
    if (movedExisting && replacementSucceeded) {
      await system.rm(backup, { force: true }).catch(() => undefined);
    }
  }
}

export async function writeAtomic(
  path: string,
  data: Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const system = options.system ?? nodeFileSystem;
  await assertSafeParents(path, options.boundary, system);
  await assertSafeDestination(path, system);
  await system.mkdir(dirname(path), { recursive: true });
  // Re-validate after directory creation so a link introduced during setup
  // cannot redirect the write.
  await assertSafeParents(path, options.boundary, system);

  const temporary = temporaryPath(path);
  try {
    await system.writeFile(temporary, data, { flag: "wx" });
    if (options.overwrite === false) {
      try {
        await system.link(temporary, path);
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
      await system.rm(temporary, { force: true });
    } else {
      await replaceWithRollback(temporary, path, system);
    }
  } finally {
    await system.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function copyAtomic(
  source: string,
  destination: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const system = options.system ?? nodeFileSystem;
  await assertSafeParents(destination, options.boundary, system);
  await assertSafeDestination(destination, system);
  await system.mkdir(dirname(destination), { recursive: true });
  await assertSafeParents(destination, options.boundary, system);

  const temporary = temporaryPath(destination);
  try {
    await system.copyFile(source, temporary);
    if (options.overwrite === false) {
      try {
        await system.link(temporary, destination);
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
      await system.rm(temporary, { force: true });
    } else {
      await replaceWithRollback(temporary, destination, system);
    }
  } finally {
    await system.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function writeTextAtomic(
  path: string,
  content: string,
  options: Pick<AtomicWriteOptions, "boundary" | "system"> = {},
): Promise<void> {
  await writeAtomic(path, Buffer.from(content, "utf8"), {
    overwrite: true,
    ...options,
  });
}
