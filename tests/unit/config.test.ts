import { describe, expect, it } from "vitest";
import { resolveOptions } from "../../src/core/resolve-options";
import { MAX_CONCURRENCY } from "../../src/config/defaults";
import { ImageSlimError } from "../../src/errors/image-slim-error";

const resolve = (options: Record<string, unknown> = {}) =>
  resolveOptions({}, { inputs: ["."], ...options }, process.cwd());

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof ImageSlimError ? error.code : "unknown";
  }
}

describe("option validation", () => {
  it("accepts concurrency up to the documented cap", () => {
    expect(resolve({ concurrency: MAX_CONCURRENCY }).concurrency).toBe(
      MAX_CONCURRENCY,
    );
  });

  it("rejects unreasonable concurrency", () => {
    expect(codeOf(() => resolve({ concurrency: 999999 }))).toBe(
      "INVALID_OPTIONS",
    );
    expect(codeOf(() => resolve({ concurrency: 0 }))).toBe("INVALID_OPTIONS");
  });

  it("rejects --remove-originals without --in-place", () => {
    expect(codeOf(() => resolve({ removeOriginals: true }))).toBe(
      "INVALID_OPTIONS",
    );
  });

  it("rejects --remove-originals without --update-references", () => {
    expect(
      codeOf(() => resolve({ removeOriginals: true, inPlace: true })),
    ).toBe("INVALID_OPTIONS");
  });

  it("rejects --remove-originals combined with --overwrite", () => {
    expect(
      codeOf(() =>
        resolve({
          removeOriginals: true,
          inPlace: true,
          updateReferences: true,
          overwrite: true,
        }),
      ),
    ).toBe("INVALID_OPTIONS");
  });

  it("allows a fully specified destructive migration", () => {
    expect(
      resolve({
        removeOriginals: true,
        inPlace: true,
        updateReferences: true,
        format: "webp",
      }).removeOriginals,
    ).toBe(true);
  });

  it("rejects --fail-on-unoptimized without --check", () => {
    expect(codeOf(() => resolve({ failOnUnoptimized: true }))).toBe(
      "INVALID_OPTIONS",
    );
  });

  it("rejects --out together with --in-place", () => {
    expect(
      codeOf(() => resolve({ inPlace: true, output: "./optimized" })),
    ).toBe("INVALID_OPTIONS");
  });

  it("implies dry-run for --check", () => {
    expect(resolve({ check: true }).dryRun).toBe(true);
  });
});
