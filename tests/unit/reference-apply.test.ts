import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyReferencePlan } from "../../src/references/scanner";
import type { ReferenceChange } from "../../src/types/public";

const temporaryDirectories: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "image-slim-apply-"));
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

function changeFor(
  filePath: string,
  content: string,
  before: string,
  after: string,
): ReferenceChange {
  const start = content.indexOf(before);
  return { filePath, start, end: start + before.length, before, after };
}

describe("applyReferencePlan", () => {
  it("writes changes and reports the count", async () => {
    const root = await createRoot();
    const file = join(root, "index.html");
    const content = '<img src="assets/hero.jpg">';
    await writeFile(file, content);

    const result = await applyReferencePlan(
      {
        filesScanned: 1,
        changes: [
          changeFor(file, content, "assets/hero.jpg", "assets/hero.webp"),
        ],
        unresolved: [],
      },
      false,
    );

    expect(result.changed).toBe(1);
    expect(await readFile(file, "utf8")).toContain("assets/hero.webp");
    await result.rollback();
    expect(await readFile(file, "utf8")).toBe(content);
  });

  it("rolls back already-written files when a later file fails", async () => {
    const root = await createRoot();
    const file = join(root, "index.html");
    const content = '<img src="assets/hero.jpg">';
    await writeFile(file, content);
    const missing = join(root, "missing.html");

    await expect(
      applyReferencePlan(
        {
          filesScanned: 2,
          changes: [
            changeFor(file, content, "assets/hero.jpg", "assets/hero.webp"),
            {
              filePath: missing,
              start: 0,
              end: 1,
              before: "x",
              after: "y",
            },
          ],
          unresolved: [],
        },
        false,
      ),
    ).rejects.toThrow();

    expect(await readFile(file, "utf8")).toBe(content);
  });

  it("does not touch files during a dry run", async () => {
    const root = await createRoot();
    const file = join(root, "index.html");
    const content = '<img src="assets/hero.jpg">';
    await writeFile(file, content);

    const result = await applyReferencePlan(
      {
        filesScanned: 1,
        changes: [
          changeFor(file, content, "assets/hero.jpg", "assets/hero.webp"),
        ],
        unresolved: [],
      },
      true,
    );

    expect(result.changed).toBe(1);
    expect(await readFile(file, "utf8")).toBe(content);
  });
});
