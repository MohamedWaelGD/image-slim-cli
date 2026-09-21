import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { checkImages, optimizeDirectory } from "../../src/index";

const temporaryDirectories: string[] = [];

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "image-slim-cli-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "assets"), { recursive: true });
  await sharp(randomBytes(160 * 160 * 3), {
    raw: { width: 160, height: 160, channels: 3 },
  })
    .jpeg({ quality: 95 })
    .toFile(join(root, "assets", "hero.jpg"));
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("optimizer integration", () => {
  it("optimizes a directory into a safe output tree", async () => {
    const root = await createFixture();
    const output = join(root, "optimized");
    const report = await optimizeDirectory(join(root, "assets"), {
      output,
      format: "webp",
      quality: 40,
      minSavingsPercentage: 0,
    });

    expect(report.filesScanned).toBe(1);
    expect(report.optimized).toBe(1);
    expect(await stat(join(output, "hero.webp"))).toBeTruthy();
    expect(await stat(join(root, "assets", "hero.jpg"))).toBeTruthy();
  });

  it("supports check mode without modifying files", async () => {
    const root = await createFixture();
    const source = join(root, "assets", "hero.jpg");
    const before = await readFile(source);
    const result = await checkImages(source, {
      format: "webp",
      quality: 40,
      minSavingsPercentage: 0,
    });

    expect(result.hasUnoptimizedFiles).toBe(true);
    expect(await readFile(source)).toEqual(before);
  });

  it("does not copy a source image under a converted extension when skipped", async () => {
    const root = await createFixture();
    const output = join(root, "optimized");
    const report = await optimizeDirectory(join(root, "assets"), {
      output,
      format: "webp",
      quality: 40,
      minSavingsPercentage: 100,
    });

    expect(report.skipped).toBe(1);
    await expect(stat(join(output, "hero.webp"))).rejects.toThrow();
  });

  it("emits progress events for API callers", async () => {
    const root = await createFixture();
    const phases: string[] = [];
    await optimizeDirectory(join(root, "assets"), {
      output: join(root, "progress-output"),
      progress: "never",
      onProgress: (event) => phases.push(event.phase),
    });

    expect(phases).toEqual([
      "discovering",
      "discovered",
      "optimizing",
      "optimizing",
      "complete",
    ]);
  });

  it("requires overwrite before replacing an output tree", async () => {
    const root = await createFixture();
    const output = join(root, "optimized");
    const options = {
      output,
      format: "webp" as const,
      quality: 40,
      minSavingsPercentage: 0,
    };
    await optimizeDirectory(join(root, "assets"), options);

    await expect(
      optimizeDirectory(join(root, "assets"), options),
    ).rejects.toThrow("Use --overwrite");
    await expect(
      optimizeDirectory(join(root, "assets"), { ...options, overwrite: true }),
    ).resolves.toMatchObject({ optimized: 1 });
  });

  it("filters a directory by a single extension", async () => {
    const root = await createFixture();
    const report = await optimizeDirectory(join(root, "assets"), {
      output: join(root, "filtered-output"),
      extensions: ["jpg"],
      format: "webp",
      quality: 40,
      minSavingsPercentage: 0,
    });

    expect(report.filesScanned).toBe(1);
  });

  it("rejects an existing in-place destination", async () => {
    const root = await createFixture();
    const source = join(root, "assets", "hero.jpg");
    await writeFile(join(root, "assets", "hero.webp"), await readFile(source));

    await expect(
      optimizeDirectory(source, {
        inPlace: true,
        format: "webp",
        quality: 40,
        minSavingsPercentage: 0,
      }),
    ).rejects.toThrow("Output already exists");
  });

  it("updates static references only when explicitly enabled", async () => {
    const root = await createFixture();
    const page = join(root, "index.html");
    await writeFile(page, '<img src="assets/hero.jpg">');

    const report = await optimizeDirectory(join(root, "assets"), {
      inPlace: true,
      format: "webp",
      quality: 40,
      minSavingsPercentage: 0,
      updateReferences: true,
      references: { roots: [root] },
    });

    expect(report.referencesChanged).toBe(1);
    expect(await readFile(page, "utf8")).toContain("assets/hero.webp");
    expect(await stat(join(root, "assets", "hero.jpg"))).toBeTruthy();
  });

  it("blocks original removal when a relevant reference is unresolved", async () => {
    const root = await createFixture();
    const source = join(root, "assets", "hero.jpg");
    await writeFile(join(root, "index.html"), '<img src="missing/hero.jpg">');

    await expect(
      optimizeDirectory(source, {
        inPlace: true,
        format: "webp",
        quality: 40,
        minSavingsPercentage: 0,
        updateReferences: true,
        removeOriginals: true,
        references: { roots: [root] },
      }),
    ).rejects.toThrow("relevant references could not be resolved");
    expect(await stat(source)).toBeTruthy();
    await expect(stat(join(root, "assets", "hero.webp"))).rejects.toThrow();
  });

  it("honors references.update and configured roots from a config file", async () => {
    const root = await createFixture();
    const source = join(root, "assets", "hero.jpg");
    const page = join(root, "index.html");
    const config = join(root, "image-slim.config.ts");
    await writeFile(page, '<img src="assets/hero.jpg">');
    await writeFile(
      config,
      `export default ${JSON.stringify({
        references: { update: true, roots: [root] },
      })}`,
    );

    const report = await optimizeDirectory(source, {
      config,
      inPlace: true,
      format: "webp",
      quality: 40,
      minSavingsPercentage: 0,
    });

    expect(report.referencesChanged).toBe(1);
    expect(await readFile(page, "utf8")).toContain("assets/hero.webp");
  });

  it("rejects invalid destructive config values", async () => {
    const root = await createFixture();
    const config = join(root, "image-slim.config.ts");
    await writeFile(config, 'export default { inPlace: "false" }');

    await expect(
      optimizeDirectory(join(root, "assets"), { config }),
    ).rejects.toThrow("inPlace must be a boolean");
  });

  it("does not rediscover output nested under the input directory", async () => {
    const root = await createFixture();
    const input = join(root, "assets");
    const output = join(input, "optimized");
    const options = {
      output,
      format: "webp" as const,
      quality: 40,
      minSavingsPercentage: 0,
    };

    await optimizeDirectory(input, options);
    const report = await optimizeDirectory(input, {
      ...options,
      overwrite: true,
    });

    expect(report.filesScanned).toBe(1);
    expect(
      report.results.every(
        (result) => !result.sourcePath.includes("optimized"),
      ),
    ).toBe(true);
  });

  it("updates quoted HTML references containing spaces", async () => {
    const root = await createFixture();
    const source = join(root, "assets", "hero.jpg");
    const spacedSource = join(root, "assets", "profile image.jpg");
    await writeFile(spacedSource, await readFile(source));
    const page = join(root, "src", "app", "index.html");
    await mkdir(join(root, "src", "app"), { recursive: true });
    await writeFile(page, '<img src="assets/profile image.jpg">');
    const component = join(root, "src", "app", "component.tsx");
    await writeFile(component, '<img src="assets/profile image.jpg" />');

    const report = await optimizeDirectory(join(root, "assets"), {
      inPlace: true,
      format: "webp",
      quality: 40,
      minSavingsPercentage: 0,
      updateReferences: true,
      references: { roots: [root] },
    });

    expect(report.referencesChanged).toBe(2);
    expect(await readFile(page, "utf8")).toContain("assets/profile image.webp");
    expect(await readFile(component, "utf8")).toContain(
      "assets/profile image.webp",
    );
  });

  it("updates CSS references containing spaces", async () => {
    const root = await createFixture();
    const source = join(root, "assets", "profile image.jpg");
    await writeFile(source, await readFile(join(root, "assets", "hero.jpg")));
    const stylesheet = join(root, "src", "app.css");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      stylesheet,
      '.hero { background: url("assets/profile image.jpg"); }',
    );

    const report = await optimizeDirectory(join(root, "assets"), {
      inPlace: true,
      format: "webp",
      quality: 40,
      minSavingsPercentage: 0,
      updateReferences: true,
      references: { roots: [root] },
    });

    expect(report.referencesChanged).toBe(1);
    expect(await readFile(stylesheet, "utf8")).toContain(
      "assets/profile image.webp",
    );
  });

  it("updates image URLs assigned to constants and HTML metadata", async () => {
    const root = await createFixture();
    const source = join(root, "assets", "hero.jpg");
    const component = join(root, "src", "component.tsx");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(component, 'const hero = "/assets/hero.jpg";');
    await writeFile(
      join(root, "index.html"),
      '<meta property="og:image" content="/assets/hero.jpg">',
    );

    const report = await optimizeDirectory(source, {
      inPlace: true,
      format: "webp",
      quality: 40,
      minSavingsPercentage: 0,
      updateReferences: true,
      references: { roots: [root] },
    });

    expect(report.referencesChanged).toBe(2);
    expect(await readFile(component, "utf8")).toContain("/assets/hero.webp");
    expect(await readFile(join(root, "index.html"), "utf8")).toContain(
      "/assets/hero.webp",
    );
  });

  it("blocks original removal for dynamic path construction and cleans outputs", async () => {
    const root = await createFixture();
    const source = join(root, "assets", "hero.jpg");
    await writeFile(
      join(root, "src.ts"),
      'const image = path.join("assets", "hero.jpg");',
    );

    await expect(
      optimizeDirectory(source, {
        inPlace: true,
        format: "webp",
        quality: 40,
        minSavingsPercentage: 0,
        updateReferences: true,
        removeOriginals: true,
        references: { roots: [root] },
      }),
    ).rejects.toThrow("relevant references could not be resolved");

    expect(await stat(source)).toBeTruthy();
    await expect(stat(join(root, "assets", "hero.webp"))).rejects.toThrow();
  });

  it("loads TypeScript configuration with CLI options taking precedence", async () => {
    const root = await createFixture();
    const output = join(root, "configured-output");
    const config = join(root, "image-slim.config.ts");
    await writeFile(
      config,
      `export default { output: ${JSON.stringify(output)}, format: "png", quality: 10, minSavingsPercentage: 0 }`,
    );

    const report = await optimizeDirectory(join(root, "assets"), {
      config,
      format: "webp",
      quality: 40,
      minSavingsPercentage: 0,
    });

    expect(report.optimized).toBe(1);
    expect(await stat(join(output, "hero.webp"))).toBeTruthy();
  });
});
