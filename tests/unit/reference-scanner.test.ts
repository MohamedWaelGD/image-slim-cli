import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOptions } from "../../src/core/resolve-options";
import { buildReferencePlan } from "../../src/references/scanner";
import type { AssetTransformation } from "../../src/types/public";

const temporaryDirectories: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "image-slim-refs-"));
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

async function plan(
  file: string,
  content: string,
  transformationOverrides: Partial<AssetTransformation> = {},
) {
  const root = await createRoot();
  const assets = join(root, "assets");
  await mkdir(assets, { recursive: true });
  const referenceFile = join(root, file);
  await mkdir(dirname(referenceFile), { recursive: true });
  await writeFile(referenceFile, content);

  const transformations: AssetTransformation[] = [
    {
      sourcePath: join(assets, "hero.jpg"),
      outputPath: join(assets, "hero.webp"),
      sourceFormat: "jpeg",
      outputFormat: "webp",
      sourceSize: 1000,
      outputSize: 500,
      ...transformationOverrides,
    },
  ];
  const options = resolveOptions(
    {},
    {
      inputs: [assets],
      inPlace: true,
      format: "webp",
      updateReferences: true,
      references: { roots: [root] },
    },
    root,
  );

  const result = await buildReferencePlan(transformations, options);
  return { result, referenceFile };
}

describe("reference scanner matrix", () => {
  it("updates relative HTML image references", async () => {
    for (const value of [
      "assets/hero.jpg",
      "./assets/hero.jpg",
      "/assets/hero.jpg",
    ]) {
      const { result } = await plan("index.html", `<img src="${value}">`);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]?.after).toContain("hero.webp");
      expect(result.unresolved).toEqual([]);
    }
  });

  it("updates srcset descriptors without touching unmatched candidates", async () => {
    const { result } = await plan(
      "index.html",
      '<img srcset="hero.jpg 1x, hero-large.jpg 2x">',
    );
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.before).toBe("hero.jpg");
  });

  it("updates Open Graph image metadata and video posters", async () => {
    const openGraph = await plan(
      "index.html",
      '<meta property="og:image" content="/assets/hero.jpg">',
    );
    expect(openGraph.result.changes).toHaveLength(1);

    const poster = await plan(
      "index.html",
      '<video poster="assets/hero.jpg"></video>',
    );
    expect(poster.result.changes).toHaveLength(1);
  });

  it("updates quoted and unquoted CSS url() references", async () => {
    for (const value of [
      '"assets/hero.jpg"',
      "'assets/hero.jpg'",
      "assets/hero.jpg",
    ]) {
      const { result } = await plan(
        "app.css",
        `a { background: url(${value}); }`,
      );
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]?.after).toContain("hero.webp");
    }
  });

  it("updates imports, constants, JSX, and new URL() references", async () => {
    const cases: Array<[string, string]> = [
      ["src/app.ts", 'import hero from "./assets/hero.jpg";'],
      ["src/app.ts", 'const hero = "/assets/hero.jpg";'],
      ["src/app.ts", 'const image = "./assets/hero.jpg";'],
      ["src/app.tsx", '<img src="./assets/hero.jpg" />'],
      ["src/app.ts", 'new URL("./hero.jpg", import.meta.url);'],
    ];
    for (const [file, content] of cases) {
      const { result } = await plan(file, content);
      expect(result.changes, `${file}: ${content}`).toHaveLength(1);
    }
  });

  it("preserves query and hash suffixes", async () => {
    for (const value of ["assets/hero.jpg?v=123", "assets/hero.jpg#hero"]) {
      const { result } = await plan("index.html", `<img src="${value}">`);
      expect(result.changes[0]?.after).toMatch(/hero\.webp[?#]/);
    }
  });

  it("updates paths containing spaces", async () => {
    const root = await createRoot();
    const assets = join(root, "assets");
    await mkdir(assets, { recursive: true });
    const referenceFile = join(root, "index.html");
    await writeFile(referenceFile, '<img src="assets/profile image.jpg">');
    const options = resolveOptions(
      {},
      {
        inputs: [assets],
        inPlace: true,
        format: "webp",
        updateReferences: true,
        references: { roots: [root] },
      },
      root,
    );
    const transformations: AssetTransformation[] = [
      {
        sourcePath: join(assets, "profile image.jpg"),
        outputPath: join(assets, "profile image.webp"),
        sourceFormat: "jpeg",
        outputFormat: "webp",
        sourceSize: 1000,
        outputSize: 500,
      },
    ];
    const result = await buildReferencePlan(transformations, options);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.after).toBe("assets/profile image.webp");
  });

  it("reports dynamic template literals as unresolved", async () => {
    const { result } = await plan(
      "src/app.ts",
      "const p = `/assets/${name}.jpg`;",
    );
    expect(result.changes).toEqual([]);
    expect(result.unresolved.map((item) => item.reason)).toContain("dynamic");
  });

  it("reports path.join construction as unresolved", async () => {
    const { result } = await plan(
      "src/app.ts",
      'const image = path.join("assets", name + ".jpg");',
    );
    expect(result.changes).toEqual([]);
    expect(result.unresolved.map((item) => item.reason)).toContain("dynamic");
  });

  it("reports string concatenation as unresolved instead of guessing", async () => {
    const { result } = await plan(
      "src/app.ts",
      'const hero = ASSET_PATH + "/hero.jpg";',
    );
    expect(result.changes).toEqual([]);
    expect(result.unresolved.map((item) => item.reason)).toContain("dynamic");
  });

  it("ignores dynamic references that cannot match a transformed image", async () => {
    const { result } = await plan(
      "src/app.ts",
      "const icon = `/icons/${name}.svg`;",
    );
    expect(result.changes).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });
});
