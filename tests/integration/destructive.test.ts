import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { optimizeDirectory } from "../../src/index";

const temporaryDirectories: string[] = [];

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "image-slim-destructive-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "assets"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await sharp(randomBytes(160 * 160 * 3), {
    raw: { width: 160, height: 160, channels: 3 },
  })
    .jpeg({ quality: 95 })
    .toFile(join(root, "assets", "hero.jpg"));
  await writeFile(
    join(root, "src", "index.html"),
    '<img src="../assets/hero.jpg">',
  );
  await writeFile(
    join(root, "src", "app.css"),
    'a { background: url("../assets/hero.jpg"); }',
  );
  await writeFile(
    join(root, "src", "app.ts"),
    'import hero from "../assets/hero.jpg";',
  );
  return root;
}

const migrate = (root: string, assets = join(root, "assets")) => ({
  inPlace: true,
  format: "webp" as const,
  quality: 40,
  minSavingsPercentage: 0,
  updateReferences: true,
  removeOriginals: true,
  references: { roots: [root] },
  path: assets,
});

async function artifacts(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries
    .map(String)
    .filter(
      (entry) =>
        entry.endsWith(".tmp") ||
        entry.endsWith(".bak") ||
        entry.endsWith(".backup"),
    );
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("destructive migration transaction", () => {
  it("completes a full JPEG to WebP migration", async () => {
    const root = await createProject();
    const { path, ...options } = migrate(root);

    const report = await optimizeDirectory(path, options);

    expect(report.optimized).toBe(1);
    expect(report.referencesChanged).toBe(3);
    expect(await exists(join(root, "assets", "hero.webp"))).toBe(true);
    expect(await exists(join(root, "assets", "hero.jpg"))).toBe(false);
    expect(await readFile(join(root, "src", "index.html"), "utf8")).toContain(
      "hero.webp",
    );
    expect(await readFile(join(root, "src", "app.css"), "utf8")).toContain(
      "hero.webp",
    );
    expect(await readFile(join(root, "src", "app.ts"), "utf8")).toContain(
      "hero.webp",
    );
    expect(await artifacts(root)).toEqual([]);
  });

  it("refuses the migration and preserves everything when a conversion fails", async () => {
    const root = await createProject();
    await writeFile(join(root, "assets", "broken.jpg"), "not an image");
    const { path, ...options } = migrate(root);

    await expect(optimizeDirectory(path, options)).rejects.toThrow();

    expect(await exists(join(root, "assets", "hero.jpg"))).toBe(true);
    expect(await exists(join(root, "assets", "broken.jpg"))).toBe(true);
    expect(await exists(join(root, "assets", "hero.webp"))).toBe(false);
    expect(await readFile(join(root, "src", "index.html"), "utf8")).toContain(
      "hero.jpg",
    );
    expect(await artifacts(root)).toEqual([]);
  });

  it("refuses the migration for unresolved dynamic references", async () => {
    const root = await createProject();
    await writeFile(
      join(root, "src", "dynamic.ts"),
      'const image = path.join("assets", fileName + ".jpg");',
    );
    const { path, ...options } = migrate(root);
    const dynamicBefore = await readFile(
      join(root, "src", "dynamic.ts"),
      "utf8",
    );

    await expect(optimizeDirectory(path, options)).rejects.toThrow(
      "relevant references could not be resolved",
    );

    expect(await exists(join(root, "assets", "hero.jpg"))).toBe(true);
    expect(await exists(join(root, "assets", "hero.webp"))).toBe(false);
    expect(await readFile(join(root, "src", "dynamic.ts"), "utf8")).toBe(
      dynamicBefore,
    );
    expect(await readFile(join(root, "src", "index.html"), "utf8")).toContain(
      "hero.jpg",
    );
    expect(await artifacts(root)).toEqual([]);
  });

  it("preserves originals and rolls back references when a reference cannot be written", async () => {
    if (process.platform === "win32") return;
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const root = await createProject();
    const pages = join(root, "src", "pages");
    await mkdir(pages, { recursive: true });
    await writeFile(
      join(pages, "index.html"),
      '<img src="../../assets/hero.jpg">',
    );
    await chmod(pages, 0o555);
    try {
      const { path, ...options } = migrate(root);
      await expect(optimizeDirectory(path, options)).rejects.toThrow();

      expect(await exists(join(root, "assets", "hero.jpg"))).toBe(true);
      expect(await exists(join(root, "assets", "hero.webp"))).toBe(false);
      expect(await readFile(join(root, "src", "index.html"), "utf8")).toContain(
        "hero.jpg",
      );
      expect(await readFile(join(pages, "index.html"), "utf8")).toContain(
        "hero.jpg",
      );
      expect(await artifacts(root)).toEqual([]);
    } finally {
      await chmod(pages, 0o755);
    }
  });

  it("aborts safely and cleans up when the filesystem rejects writes", async () => {
    if (process.platform === "win32") return;
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const root = await createProject();
    const assets = join(root, "assets");
    await chmod(assets, 0o555);
    try {
      const { path, ...options } = migrate(root);
      await expect(optimizeDirectory(path, options)).rejects.toThrow();

      expect(await exists(join(assets, "hero.jpg"))).toBe(true);
      expect(await exists(join(assets, "hero.webp"))).toBe(false);
      expect(await readFile(join(root, "src", "index.html"), "utf8")).toContain(
        "hero.jpg",
      );
      expect(await artifacts(root)).toEqual([]);
      expect((await lstat(join(assets, "hero.jpg"))).isFile()).toBe(true);
    } finally {
      await chmod(assets, 0o755);
    }
  });
});
