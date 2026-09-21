import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyAtomic,
  writeAtomic,
  writeTextAtomic,
  type AtomicFileSystem,
} from "../../src/filesystem/atomic";

const nodeFileSystem: AtomicFileSystem = {
  lstat,
  mkdir,
  writeFile,
  rename,
  rm,
  link,
  copyFile,
};

const temporaryDirectories: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "image-slim-atomic-"));
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

async function entries(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true })).map(String);
}

async function transientArtifacts(directory: string): Promise<string[]> {
  return (await entries(directory)).filter(
    (entry) => entry.endsWith(".tmp") || entry.endsWith(".bak"),
  );
}

async function createDirLink(
  target: string,
  linkPath: string,
): Promise<boolean> {
  try {
    await symlink(
      target,
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    return true;
  } catch {
    return false;
  }
}

describe("writeAtomic", () => {
  it("writes a new file and removes temporary artifacts", async () => {
    const root = await createRoot();
    const target = join(root, "nested", "out.bin");
    await writeAtomic(target, new Uint8Array([1, 2, 3]));

    expect(await readFile(target)).toEqual(Buffer.from([1, 2, 3]));
    expect(await transientArtifacts(root)).toEqual([]);
  });

  it("overwrites an existing file and removes backup artifacts", async () => {
    const root = await createRoot();
    const target = join(root, "out.bin");
    await writeFile(target, "old");
    await writeAtomic(target, Buffer.from("new"));

    expect(await readFile(target, "utf8")).toBe("new");
    expect(await transientArtifacts(root)).toEqual([]);
  });

  it("refuses to write when overwrite is false and the file exists", async () => {
    const root = await createRoot();
    const target = join(root, "out.bin");
    await writeFile(target, "old");

    await expect(
      writeAtomic(target, Buffer.from("new"), { overwrite: false }),
    ).rejects.toThrow("Output already exists");
    expect(await readFile(target, "utf8")).toBe("old");
    expect(await transientArtifacts(root)).toEqual([]);
  });

  it("leaves the original untouched when the write fails", async () => {
    const root = await createRoot();
    const target = join(root, "out.bin");
    await writeFile(target, "original");
    const system: AtomicFileSystem = {
      ...nodeFileSystem,
      writeFile: async () => {
        throw new Error("disk full");
      },
    };

    await expect(
      writeAtomic(target, Buffer.from("new"), { system }),
    ).rejects.toThrow("disk full");
    expect(await readFile(target, "utf8")).toBe("original");
    expect(await transientArtifacts(root)).toEqual([]);
  });

  it("restores the original when the replacement rename fails", async () => {
    const root = await createRoot();
    const target = join(root, "out.bin");
    await writeFile(target, "original");
    const system: AtomicFileSystem = {
      ...nodeFileSystem,
      rename: async (from, to) => {
        if (String(from).endsWith(".tmp")) throw new Error("rename failed");
        return rename(from, to);
      },
    };

    await expect(
      writeAtomic(target, Buffer.from("new"), { system }),
    ).rejects.toThrow("rename failed");
    expect(await readFile(target, "utf8")).toBe("original");
    expect(await transientArtifacts(root)).toEqual([]);
  });

  it("preserves a recoverable backup when replacement and restore both fail", async () => {
    const root = await createRoot();
    const target = join(root, "out.bin");
    await writeFile(target, "original");
    const system: AtomicFileSystem = {
      ...nodeFileSystem,
      rename: async (from, to) => {
        if (String(from).endsWith(".tmp") || String(from).endsWith(".bak"))
          throw new Error("rename blocked");
        return rename(from, to);
      },
    };

    await expect(
      writeAtomic(target, Buffer.from("new"), { system }),
    ).rejects.toThrow("recoverable backup");
    const backups = (await entries(root)).filter((entry) =>
      entry.endsWith(".bak"),
    );
    expect(backups).toHaveLength(1);
    expect(await readFile(join(root, backups[0] as string), "utf8")).toBe(
      "original",
    );
  });

  it("keeps the replaced content when backup cleanup fails", async () => {
    const root = await createRoot();
    const target = join(root, "out.bin");
    await writeFile(target, "original");
    const system: AtomicFileSystem = {
      ...nodeFileSystem,
      rm: async (path, options) => {
        if (String(path).endsWith(".bak")) throw new Error("rm blocked");
        return rm(path, options);
      },
    };

    await expect(
      writeAtomic(target, Buffer.from("new"), { system }),
    ).resolves.toBeUndefined();
    expect(await readFile(target, "utf8")).toBe("new");
  });

  it("refuses to replace a symbolic-link destination", async () => {
    const root = await createRoot();
    const real = join(root, "real.bin");
    const link = join(root, "link.bin");
    await writeFile(real, "original");
    try {
      await symlink(real, link, "file");
    } catch {
      return; // symlink creation requires privileges on some Windows setups
    }

    await expect(writeAtomic(link, Buffer.from("new"))).rejects.toThrow(
      "symbolic link",
    );
    expect(await readFile(real, "utf8")).toBe("original");
  });

  it("refuses to write through a symbolic-link parent below the boundary", async () => {
    const root = await createRoot();
    const outside = join(root, "outside");
    const inside = join(root, "inside");
    await mkdir(outside, { recursive: true });
    await mkdir(inside, { recursive: true });
    if (!(await createDirLink(outside, join(inside, "link")))) return;

    await expect(
      writeAtomic(join(inside, "link", "escape.bin"), Buffer.from("data"), {
        boundary: inside,
      }),
    ).rejects.toThrow("symbolic link");
    expect(await entries(outside)).toEqual([]);
  });

  it("refuses a nested symbolic-link parent", async () => {
    const root = await createRoot();
    const outside = join(root, "outside");
    const inside = join(root, "inside");
    await mkdir(outside, { recursive: true });
    await mkdir(join(inside, "a"), { recursive: true });
    if (!(await createDirLink(outside, join(inside, "a", "link")))) return;

    await expect(
      writeAtomic(
        join(inside, "a", "link", "deep", "escape.bin"),
        Buffer.from("data"),
        {
          boundary: inside,
        },
      ),
    ).rejects.toThrow("symbolic link");
  });

  it("trusts the boundary directory itself", async () => {
    const root = await createRoot();
    const real = join(root, "real");
    await mkdir(real, { recursive: true });
    const link = join(root, "link");
    if (!(await createDirLink(real, link))) return;

    await writeAtomic(join(link, "file.bin"), Buffer.from("data"), {
      boundary: link,
    });
    expect(await readFile(join(real, "file.bin"), "utf8")).toBe("data");
  });

  it("handles spaces, unicode, and special characters in paths", async () => {
    const root = await createRoot();
    const directory = join(root, "a dir with spaces", "üñîçødé & #hash");
    const target = join(directory, "my file (1)+x.bin");
    await writeAtomic(target, Buffer.from("data"));
    expect(await readFile(target, "utf8")).toBe("data");
    expect(await transientArtifacts(root)).toEqual([]);
  });

  it("handles a long file name where the platform permits it", async () => {
    const root = await createRoot();
    const name = `${"a".repeat(180)}.bin`;
    const target = join(root, name);
    try {
      await writeAtomic(target, Buffer.from("data"));
    } catch (error) {
      if (process.platform === "win32") return; // path length limits vary
      throw error;
    }
    expect(await readFile(target, "utf8")).toBe("data");
  });
});

describe("copyAtomic", () => {
  it("copies a file atomically without leftovers", async () => {
    const root = await createRoot();
    const source = join(root, "source.bin");
    const destination = join(root, "nested", "copy.bin");
    await writeFile(source, "payload");
    await copyAtomic(source, destination);

    expect(await readFile(destination, "utf8")).toBe("payload");
    expect(await transientArtifacts(root)).toEqual([]);
  });

  it("refuses an existing destination when overwrite is false", async () => {
    const root = await createRoot();
    const source = join(root, "source.bin");
    const destination = join(root, "copy.bin");
    await writeFile(source, "payload");
    await writeFile(destination, "existing");

    await expect(
      copyAtomic(source, destination, { overwrite: false }),
    ).rejects.toThrow("Output already exists");
    expect(await readFile(destination, "utf8")).toBe("existing");
  });
});

describe("writeTextAtomic", () => {
  it("writes text and replaces existing content", async () => {
    const root = await createRoot();
    const target = join(root, "note.txt");
    await writeTextAtomic(target, "first");
    await writeTextAtomic(target, "second");
    expect(await readFile(target, "utf8")).toBe("second");
    expect(await transientArtifacts(root)).toEqual([]);
  });
});
