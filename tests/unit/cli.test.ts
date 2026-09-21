import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli";

const temporaryDirectories: string[] = [];
let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;

async function createImageDirectory(): Promise<string> {
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

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(async () => {
  stdout.mockRestore();
  stderr.mockRestore();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CLI exit codes", () => {
  it("returns 0 for version and help", async () => {
    await expect(main(["node", "image-slim", "--version"])).resolves.toBe(0);
    await expect(main(["node", "image-slim", "--help"])).resolves.toBe(0);
  });

  it("returns 2 for invalid arguments", async () => {
    await expect(
      main(["node", "image-slim", "--format", "invalid"]),
    ).resolves.toBe(2);
    await expect(
      main(["node", "image-slim", "--concurrency", "999999"]),
    ).resolves.toBe(2);
    await expect(
      main(["node", "image-slim", "--remove-originals"]),
    ).resolves.toBe(2);
    await expect(
      main(["node", "image-slim", "--fail-on-unoptimized"]),
    ).resolves.toBe(2);
  });

  it("returns 1 when a check finds unoptimized assets", async () => {
    const root = await createImageDirectory();
    await expect(
      main([
        "node",
        "image-slim",
        join(root, "assets"),
        "--check",
        "--fail-on-unoptimized",
        "--format",
        "webp",
        "--progress",
        "never",
      ]),
    ).resolves.toBe(1);
  });

  it("returns 3 when an image cannot be processed", async () => {
    const root = await createImageDirectory();
    await writeFile(join(root, "assets", "broken.jpg"), "not an image");
    await expect(
      main([
        "node",
        "image-slim",
        join(root, "assets"),
        "--format",
        "webp",
        "--out",
        join(root, "optimized"),
        "--progress",
        "never",
      ]),
    ).resolves.toBe(3);
  });

  it("returns 3 when the input cannot be found", async () => {
    await expect(
      main([
        "node",
        "image-slim",
        join(tmpdir(), "image-slim-missing-input"),
        "--progress",
        "never",
      ]),
    ).resolves.toBe(3);
  });
});
