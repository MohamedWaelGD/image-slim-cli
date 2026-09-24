import { resolve } from "node:path";
import {
  DEFAULT_CONFIG,
  DEFAULT_INPUT_IGNORES,
  DEFAULT_REFERENCE_EXCLUDE,
  DEFAULT_REFERENCE_INCLUDE,
} from "../config/defaults";
import { mergeConfig } from "../config/merge";
import { validateConfig } from "../config/validate";
import { ImageSlimError } from "../errors/image-slim-error";
import { parseByteSize } from "../filesystem/size";
import type { ImageSlimConfig, RunOptions } from "../types/public";
import type { ResolvedRunOptions } from "./types";

export function resolveOptions(
  fileConfig: ImageSlimConfig,
  cliOptions: RunOptions,
  cwd = process.cwd(),
): ResolvedRunOptions {
  validateConfig({
    ...fileConfig,
    updateReferences:
      fileConfig.updateReferences ?? fileConfig.references?.update,
  });
  validateConfig({
    ...cliOptions,
    updateReferences:
      cliOptions.updateReferences ?? cliOptions.references?.update,
  });
  const merged = mergeConfig(fileConfig, cliOptions);
  const inputs = merged.inputs ?? [];
  if (merged.inPlace && merged.output) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      "--out cannot be used with --in-place.",
    );
  }
  const output = resolve(cwd, merged.output ?? "optimized");

  const raw = {
    ...DEFAULT_CONFIG,
    ...merged,
    inputs,
    output,
    include: merged.include ?? [],
    exclude: merged.exclude?.length
      ? merged.exclude
      : [...DEFAULT_INPUT_IGNORES],
    references: {
      include: [
        ...DEFAULT_REFERENCE_INCLUDE,
        ...(merged.references?.include ?? []),
      ],
      exclude: [
        ...DEFAULT_REFERENCE_EXCLUDE,
        ...(merged.references?.exclude ?? []),
      ],
      ...merged.references,
    },
  } as ImageSlimConfig & { inputs: string[]; output: string };

  const parsed = {
    ...raw,
    targetSize:
      typeof raw.targetSize === "string"
        ? parseByteSize(raw.targetSize)
        : raw.targetSize,
  };

  parsed.references = parsed.references ?? {};

  validateConfig({
    ...parsed,
    output: parsed.inPlace ? undefined : parsed.output,
  });

  if (parsed.inputs.length === 0) {
    throw new ImageSlimError(
      "INVALID_INPUT",
      "No input was provided. Add a path or configure input.",
    );
  }

  if (parsed.check) parsed.dryRun = true;
  if (parsed.updateReferences) parsed.references.update = true;

  return {
    inputs: parsed.inputs,
    output: parsed.output,
    format: parsed.format ?? "original",
    quality: parsed.quality ?? 82,
    minQuality: parsed.minQuality ?? Math.min(40, parsed.quality ?? 82),
    targetSize: parsed.targetSize,
    maxWidth: parsed.maxWidth,
    maxHeight: parsed.maxHeight,
    allowUpscale: parsed.allowUpscale ?? false,
    background: parsed.background ?? "#ffffff",
    metadata: parsed.metadata ?? "strip",
    skipIfLarger: parsed.allowLarger ? false : (parsed.skipIfLarger ?? true),
    allowLarger: parsed.allowLarger ?? false,
    minSavingsPercentage: parsed.minSavingsPercentage ?? 5,
    concurrency: parsed.concurrency ?? 2,
    followSymlinks: parsed.followSymlinks ?? false,
    inPlace: parsed.inPlace ?? false,
    removeOriginals: parsed.removeOriginals ?? false,
    updateReferences:
      parsed.updateReferences ?? parsed.references.update ?? false,
    include: parsed.include ?? [],
    exclude: parsed.exclude ?? [...DEFAULT_INPUT_IGNORES],
    extensions: parsed.extensions,
    references: parsed.references,
    dryRun: parsed.dryRun ?? false,
    check: parsed.check ?? false,
    failOnUnoptimized: parsed.failOnUnoptimized ?? false,
    failOnTargetSize: parsed.failOnTargetSize ?? false,
    verbose: parsed.verbose ?? false,
    report: parsed.report ?? "text",
    progress: parsed.progress ?? "auto",
    overwrite: parsed.overwrite ?? false,
    onProgress: parsed.onProgress,
    signal: parsed.signal,
    cwd,
  };
}
