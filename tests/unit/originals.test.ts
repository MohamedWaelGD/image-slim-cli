import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  removeOriginalsSafely,
  type OriginalsFileSystem,
} from "../../src/filesystem/originals";

const temporaryDirectories: string[] = [];

const nodeFileSystem: OriginalsFileSystem = { copyFile, unlink, rm };

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "image-slim-originals-"));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("removeOriginalsSafely", () => {
  it("removes originals and their backups on success", async () => {
    const root = await createRoot();
    const sources = [join(root, "a.jpg"), join(root, "b.jpg")];
    await Promise.all(sources.map((source) => writeFile(source, "image")));

    await removeOriginalsSafely(
      sources.map((sourcePath) => ({ sourcePath })),
      async () => undefined,
    );

    await expect(readFile(sources[0] as string)).rejects.toThrow();
    await expect(readFile(sources[1] as string)).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });

  it("leaves originals in place when backing up fails", async () => {
    const root = await createRoot();
    const sources = [join(root, "a.jpg"), join(root, "b.jpg")];
    await Promise.all(sources.map((source) => writeFile(source, "image")));
    const rollback = vi.fn(async () => undefined);
    const system: OriginalsFileSystem = {
      ...nodeFileSystem,
      copyFile: async () => {
        throw new Error("backup failed");
      },
    };

    await expect(
      removeOriginalsSafely(
        sources.map((sourcePath) => ({ sourcePath })),
        rollback,
        system,
      ),
    ).rejects.toThrow("rolled back");
    expect(await readFile(sources[0] as string, "utf8")).toBe("image");
    expect(await readFile(sources[1] as string, "utf8")).toBe("image");
    expect(rollback).toHaveBeenCalledOnce();
    expect(await readdir(root)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("restores already-deleted originals and rolls back references", async () => {
    const root = await createRoot();
    const sources = [join(root, "a.jpg"), join(root, "b.jpg")];
    await Promise.all(sources.map((source) => writeFile(source, "image")));
    const rollback = vi.fn(async () => undefined);
    const system: OriginalsFileSystem = {
      ...nodeFileSystem,
      unlink: async (path) => {
        if (String(path).endsWith("b.jpg")) throw new Error("delete blocked");
        return unlink(path);
      },
    };

    await expect(
      removeOriginalsSafely(
        sources.map((sourcePath) => ({ sourcePath })),
        rollback,
        system,
      ),
    ).rejects.toThrow("rolled back");

    expect(await readFile(sources[0] as string, "utf8")).toBe("image");
    expect(await readFile(sources[1] as string, "utf8")).toBe("image");
    expect(rollback).toHaveBeenCalledOnce();
    expect(
      (await readdir(root)).filter((entry) => entry.endsWith(".backup")),
    ).toEqual([]);
  });

  it("keeps a recoverable backup when restoration also fails", async () => {
    const root = await createRoot();
    const source = join(root, "a.jpg");
    await writeFile(source, "image");
    const system: OriginalsFileSystem = {
      ...nodeFileSystem,
      unlink: async () => {
        throw new Error("delete blocked");
      },
      copyFile: async (from, to) => {
        if (String(from).endsWith(".backup"))
          throw new Error("restore blocked");
        return copyFile(from, to);
      },
    };

    await expect(
      removeOriginalsSafely(
        [{ sourcePath: source }],
        async () => undefined,
        system,
      ),
    ).rejects.toThrow("rolled back");

    const backups = (await readdir(root)).filter((entry) =>
      entry.endsWith(".backup"),
    );
    expect(backups).toHaveLength(1);
  });
});
