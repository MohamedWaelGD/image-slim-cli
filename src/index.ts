import { loadConfig } from "./config/loader";
import { resolveOptions } from "./core/resolve-options";
import { hasUnoptimizedFiles, runOptimization } from "./core/run";
import type {
  CheckResult,
  OptimizationReport,
  RunOptions,
} from "./types/public";

async function runWithInputs(
  inputs: string[],
  options: RunOptions = {},
): Promise<OptimizationReport> {
  const loaded = await loadConfig(options.config);
  const resolved = resolveOptions(loaded.config, { ...options, inputs });
  return runOptimization(resolved);
}

export function optimizeFile(
  path: string,
  options: RunOptions = {},
): Promise<OptimizationReport> {
  return runWithInputs([path], options);
}

export function optimizeDirectory(
  path: string,
  options: RunOptions = {},
): Promise<OptimizationReport> {
  return runWithInputs([path], options);
}

export function optimize(
  inputs: string | string[],
  options: RunOptions = {},
): Promise<OptimizationReport> {
  return runWithInputs(Array.isArray(inputs) ? inputs : [inputs], options);
}

export async function checkImages(
  inputs: string | string[],
  options: RunOptions = {},
): Promise<CheckResult> {
  const report = await runWithInputs(
    Array.isArray(inputs) ? inputs : [inputs],
    {
      ...options,
      check: true,
      dryRun: true,
    },
  );
  return { report, hasUnoptimizedFiles: hasUnoptimizedFiles(report) };
}

export { defineConfig } from "./types/public";
export { ImageSlimError } from "./errors/image-slim-error";
export type {
  AssetTransformation,
  CheckResult,
  FileOptimizationResult,
  ImageFormat,
  ImageMetadata,
  ImageSlimConfig,
  MetadataMode,
  OptimizationOptions,
  OptimizationReport,
  ProgressEvent,
  ProgressHandler,
  ProgressMode,
  ReferenceChange,
  ReferenceOptions,
  ReportFormat,
  RunOptions,
  UnresolvedReference,
} from "./types/public";
export type { ImageSlimErrorCode } from "./errors/image-slim-error";
