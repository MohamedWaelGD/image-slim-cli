import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOptions } from "../../src/core/resolve-options";
import { discoverFiles } from "../../src/filesystem/discovery";
import {
  planOutputs,
  validateOutputPlan,
} from "../../src/filesystem/output-plan";
import {
  commonPath,
  ensureContained,
  makeRelativePath,
  pathForFormat,
  pathIdentity,
  staticGlobBase,
} from "../../src/filesystem/paths";

const temporaryDirectories: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "image-slim-fs-"));
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

describe("path helpers", () => {
  it("computes a shared root", () => {
    const root = join("C:", "project");
    expect(commonPath([join(root, "a"), join(root, "b")]).toLowerCase()).toBe(
      root.toLowerCase(),
    );
  });

  it("swaps the format extension", () => {
    expect(pathForFormat("assets/hero.jpeg", "webp")).toBe("assets/hero.webp");
    expect(pathForFormat("assets/hero.png", "jpeg")).toBe("assets/hero.jpg");
  });

  it("derives relative paths", () => {
    expect(makeRelativePath("/a/b/c.jpg", "/a/b")).toBe("c.jpg");
  });

  it("refuses paths that escape the output root", () => {
    expect(() => ensureContained("/a/out", "/a/out/x.jpg")).not.toThrow();
    expect(() => ensureContained("/a/out", "/a/other/x.jpg")).toThrow(
      "escapes the output directory",
    );
  });

  it("treats identities case-insensitively only on Windows", () => {
    const upper = pathIdentity("/a/Hero.jpg");
    const lower = pathIdentity("/a/hero.jpg");
    if (process.platform === "win32") expect(upper).toBe(lower);
    else expect(upper).not.toBe(lower);
  });

  it("derives the static base of a glob", () => {
    const base = staticGlobBase("assets/**/*.jpg", "/project");
    expect(pathIdentity(base)).toBe(pathIdentity("/project/assets"));
  });
});

describe("planOutputs", () => {
  const options = (cwd: string, overrides: Record<string, unknown> = {}) =>
    resolveOptions({}, { inputs: ["."], ...overrides }, cwd);

  it("rejects an output that is the input file", async () => {
    const root = await createRoot();
    const assets = join(root, "assets");
    await mkdir(assets, { recursive: true });
    const hero = join(assets, "hero.jpg");
    await writeFile(hero, "x");

    expect(() =>
      planOutputs(
        [{ absolutePath: hero, relativePath: "hero.jpg", root: assets }],
        options(root, { output: assets }),
      ),
    ).toThrow("Output would overwrite the input file");
  });

  it("rejects duplicate output identities", async () => {
    const root = await createRoot();
    const assets = join(root, "assets");
    await mkdir(assets, { recursive: true });
    const first = join(assets, "Hero.jpg");
    const second = join(assets, "hero.jpg");
    await writeFile(first, "x");
    await writeFile(second, "x");

    const plan = () =>
      planOutputs(
        [
          { absolutePath: first, relativePath: "Hero.jpg", root: assets },
          { absolutePath: second, relativePath: "hero.jpg", root: assets },
        ],
        options(root, { output: join(root, "optimized"), format: "webp" }),
      );

    if (process.platform === "win32") expect(plan).toThrow("same output");
    else expect(plan).not.toThrow();
  });

  it("records outputs that already exist", async () => {
    const root = await createRoot();
    const assets = join(root, "assets");
    const output = join(root, "optimized");
    await mkdir(assets, { recursive: true });
    await mkdir(output, { recursive: true });
    const hero = join(assets, "hero.jpg");
    await writeFile(hero, "x");
    await writeFile(join(output, "hero.webp"), "existing");

    const resolved = options(root, { output, format: "webp", overwrite: true });
    const files = planOutputs(
      [{ absolutePath: hero, relativePath: "hero.jpg", root: assets }],
      resolved,
    );
    const validation = await validateOutputPlan(files, resolved);

    expect(
      validation.preExisting.has(pathIdentity(join(output, "hero.webp"))),
    ).toBe(true);
  });

  it("refuses a symbolic-link output directory", async () => {
    const root = await createRoot();
    const assets = join(root, "assets");
    const real = join(root, "real-output");
    const link = join(root, "optimized");
    await mkdir(assets, { recursive: true });
    await mkdir(real, { recursive: true });
    const hero = join(assets, "hero.jpg");
    await writeFile(hero, "x");
    try {
      await symlink(
        real,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch {
      return;
    }

    const resolved = options(root, { output: link, format: "webp" });
    const files = planOutputs(
      [{ absolutePath: hero, relativePath: "hero.jpg", root: assets }],
      resolved,
    );
    await expect(validateOutputPlan(files, resolved)).rejects.toThrow(
      "symbolic-link output directory",
    );
  });
});

describe("discoverFiles", () => {
  it("excludes symbolic-link files unless followSymlinks is enabled", async () => {
    const root = await createRoot();
    const real = join(root, "real.jpg");
    const link = join(root, "link.jpg");
    await writeFile(real, "x");
    try {
      await symlink(real, link, "file");
    } catch {
      return;
    }

    const safe = await discoverFiles([root], { followSymlinks: false }, root);
    expect(safe.map((file) => resolve(file.absolutePath))).not.toContain(
      resolve(link),
    );

    const unsafe = await discoverFiles([root], { followSymlinks: true }, root);
    expect(unsafe.map((file) => resolve(file.absolutePath))).toContain(
      resolve(link),
    );
  });

  it("refuses an explicit symbolic-link file input", async () => {
    const root = await createRoot();
    const real = join(root, "real.jpg");
    const link = join(root, "link.jpg");
    await writeFile(real, "x");
    try {
      await symlink(real, link, "file");
    } catch {
      return;
    }

    await expect(
      discoverFiles([link], { followSymlinks: false }, root),
    ).rejects.toThrow("symbolic-link input");
  });
});
