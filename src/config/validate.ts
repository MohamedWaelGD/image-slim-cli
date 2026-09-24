import { ImageSlimError } from "../errors/image-slim-error";
import { MAX_CONCURRENCY } from "./defaults";
import type { ImageFormat, ImageSlimConfig } from "../types/public";

const FORMATS = new Set<ImageFormat>(["original", "jpeg", "png", "webp", "avif"]);

function assertStringArray(name: string, value: unknown): void {
  if (
    value !== undefined &&
    (!Array.isArray(value) ||
      value.some((item) => typeof item !== "string" || item.length === 0))
  ) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      `${name} must be an array of non-empty strings.`,
    );
  }
}

function assertPositiveInteger(name: string, value: unknown): void {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      `${name} must be an integer greater than zero.`,
    );
  }
}

function assertOptionalBoolean(name: string, value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new ImageSlimError("INVALID_OPTIONS", `${name} must be a boolean.`);
  }
}

export function validateConfig(config: ImageSlimConfig): void {
  if (config.format !== undefined && !FORMATS.has(config.format)) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      `Unsupported output format: ${String(config.format)}.`,
    );
  }

  if (
    config.quality !== undefined &&
    (!Number.isFinite(config.quality) ||
      config.quality < 1 ||
      config.quality > 100)
  ) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "quality must be a finite number from 1 to 100.",
    );
  }

  if (
    config.minQuality !== undefined &&
    (!Number.isInteger(config.minQuality) ||
      config.minQuality < 1 ||
      config.minQuality > 100)
  ) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "minQuality must be an integer from 1 to 100.",
    );
  }
  if (
    config.minQuality !== undefined &&
    config.quality !== undefined &&
    config.minQuality > config.quality
  ) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "minQuality cannot be greater than quality.",
    );
  }

  for (const [name, value] of [
    ["maxWidth", config.maxWidth],
    ["maxHeight", config.maxHeight],
    ["targetSize", config.targetSize],
  ] as const) {
    if (value !== undefined) {
      if (name === "targetSize" && typeof value === "string") {
        if (value.trim().length === 0) {
          throw new ImageSlimError(
            "INVALID_OPTIONS",
            "targetSize must be a positive byte size.",
          );
        }
        continue;
      }
      assertPositiveInteger(name, value);
    }
  }

  if (
    config.minSavingsPercentage !== undefined &&
    (!Number.isFinite(config.minSavingsPercentage) ||
      config.minSavingsPercentage < 0 ||
      config.minSavingsPercentage > 100)
  ) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "minSavingsPercentage must be between 0 and 100.",
    );
  }

  if (config.concurrency !== undefined) {
    assertPositiveInteger("concurrency", config.concurrency);
    if (config.concurrency > MAX_CONCURRENCY) {
      throw new ImageSlimError(
        "INVALID_OPTIONS",
        `concurrency must be at most ${MAX_CONCURRENCY}.`,
      );
    }
  }

  for (const [name, value] of [
    ["allowUpscale", config.allowUpscale],
    ["skipIfLarger", config.skipIfLarger],
    ["allowLarger", config.allowLarger],
    ["inPlace", config.inPlace],
    ["followSymlinks", config.followSymlinks],
    ["removeOriginals", config.removeOriginals],
    ["updateReferences", config.updateReferences],
    ["dryRun", config.dryRun],
    ["check", config.check],
    ["failOnUnoptimized", config.failOnUnoptimized],
    ["failOnTargetSize", config.failOnTargetSize],
    ["verbose", config.verbose],
    ["overwrite", config.overwrite],
  ] as const) {
    assertOptionalBoolean(name, value);
  }

  if (
    config.allowUpscale !== undefined &&
    typeof config.allowUpscale !== "boolean"
  ) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "allowUpscale must be a boolean.",
    );
  }

  if (
    config.metadata !== undefined &&
    !["strip", "keep"].includes(config.metadata)
  ) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "metadata must be strip or keep.",
    );
  }

  if (
    config.report !== undefined &&
    !["text", "json"].includes(config.report)
  ) {
    throw new ImageSlimError("INVALID_OPTIONS", "report must be text or json.");
  }

  if (
    config.progress !== undefined &&
    !["auto", "always", "never"].includes(config.progress)
  ) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "progress must be auto, always, or never.",
    );
  }

  if (config.overwrite !== undefined && typeof config.overwrite !== "boolean") {
    throw new ImageSlimError("INVALID_OPTIONS", "overwrite must be a boolean.");
  }

  assertStringArray("inputs", config.inputs);
  if (
    config.input !== undefined &&
    !(
      typeof config.input === "string" ||
      (Array.isArray(config.input) &&
        config.input.every(
          (item) => typeof item === "string" && item.length > 0,
        ))
    )
  ) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "input must be a path string or an array of non-empty strings.",
    );
  }
  assertStringArray("include", config.include);
  assertStringArray("exclude", config.exclude);
  assertStringArray("extensions", config.extensions);

  if (config.output !== undefined && typeof config.output !== "string") {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "output must be a path string.",
    );
  }

  if (
    config.references !== undefined &&
    (typeof config.references !== "object" || config.references === null)
  ) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "references must be an object.",
    );
  }
  if (config.references) {
    assertOptionalBoolean("references.update", config.references.update);
    assertStringArray("references.roots", config.references.roots);
    assertStringArray("references.include", config.references.include);
    assertStringArray("references.exclude", config.references.exclude);
  }

  if (config.inPlace && config.output) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "--out cannot be used with --in-place.",
    );
  }

  if (config.failOnUnoptimized && !config.check) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "--fail-on-unoptimized requires --check.",
    );
  }

  if (config.removeOriginals && !config.inPlace) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "--remove-originals requires --in-place.",
    );
  }

  if (config.removeOriginals && !config.updateReferences) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "--remove-originals requires --update-references to protect source references.",
    );
  }

  if (config.removeOriginals && config.overwrite) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "--remove-originals cannot be combined with --overwrite because replaced files cannot be rolled back.",
    );
  }
}
