import { copyFile, rm, unlink } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { basename } from "node:path";
import { discoverFiles } from "../filesystem/discovery";
import {
  planOutputs,
  validateOutputPlan,
  type PlannedFile,
} from "../filesystem/output-plan";
import { ImageSlimError } from "../errors/image-slim-error";
import { buildReferencePlan, applyReferencePlan } from "../references/scanner";
import type {
  FileOptimizationResult,
  OptimizationReport,
} from "../types/public";
import { mapWithConcurrency } from "./scheduler";
import { optimizeFile } from "./optimize-file";
import type { ResolvedRunOptions } from "./types";

function failedResult(
  file: PlannedFile,
  error: unknown,
): FileOptimizationResult {
  const imageError =
    error instanceof ImageSlimError
      ? error
      : new ImageSlimError(
          "ENCODE_FAILED",
          `Unable to optimize image: ${file.absolutePath}`,
          { cause: error },
        );
  return {
    sourcePath: file.absolutePath,
    outputPath: file.outputPath,
    status: "failed",
    original: { size: 0, width: 0, height: 0, format: "unknown" },
    savingsBytes: 0,
    savingsPercentage: 0,
    error: { code: imageError.code, message: imageError.message },
  };
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ImageSlimError("ABORTED", "Image optimization was interrupted.", {
      cause: signal.reason,
    });
  }
}

async function removeOriginalsSafely(
  transformations: Array<{ sourcePath: string }>,
  rollbackReferences: () => Promise<void>,
): Promise<void> {
  const backups: Array<{ sourcePath: string; backupPath: string }> = [];
  try {
    for (const [index, transformation] of transformations.entries()) {
      const backupPath = `${transformation.sourcePath}.${basename(transformation.sourcePath)}.${process.pid}.${Date.now()}.${index}.backup`;
      await copyFile(transformation.sourcePath, backupPath);
      backups.push({ sourcePath: transformation.sourcePath, backupPath });
    }
    for (const transformation of transformations) {
      await unlink(transformation.sourcePath);
    }
  } catch (error) {
    for (const backup of backups) {
      try {
        await copyFile(backup.backupPath, backup.sourcePath);
      } catch {
        // Preserve the original failure; the backup remains available for recovery.
      }
    }
    await rollbackReferences();
    await Promise.all(
      backups.map((backup) => rm(backup.backupPath, { force: true })),
    );
    throw new ImageSlimError(
      "REFERENCE_UPDATE_FAILED",
      "Unable to remove originals safely; changes were rolled back.",
      { cause: error },
    );
  }
  await Promise.all(
    backups.map((backup) => rm(backup.backupPath, { force: true })),
  );
}

export async function runOptimization(
  options: ResolvedRunOptions,
): Promise<OptimizationReport> {
  const started = performance.now();
  assertNotAborted(options.signal);
  options.onProgress?.({ phase: "discovering" });
  const discovered = await discoverFiles(
    options.inputs,
    {
      ...options,
      output: options.inPlace ? undefined : options.output,
    },
    options.cwd,
  );
  if (discovered.length === 0) {
    throw new ImageSlimError(
      "INVALID_INPUT",
      "No supported image files were found in the provided inputs.",
    );
  }
  options.onProgress?.({ phase: "discovered", total: discovered.length });
  const planned = planOutputs(discovered, options);
  await validateOutputPlan(planned, options);

  let completed = 0;
  const results = await mapWithConcurrency(
    planned,
    options.concurrency,
    async (file) => {
      assertNotAborted(options.signal);
      options.onProgress?.({
        phase: "optimizing",
        completed,
        total: planned.length,
        file: file.absolutePath,
        status: "started",
      });
      try {
        const result = await optimizeFile(file, options);
        completed += 1;
        options.onProgress?.({
          phase: "optimizing",
          completed,
          total: planned.length,
          file: file.absolutePath,
          status: "completed",
        });
        return result;
      } catch (error) {
        if (error instanceof ImageSlimError && error.code === "ABORTED")
          throw error;
        const result = failedResult(file, error);
        completed += 1;
        options.onProgress?.({
          phase: "optimizing",
          completed,
          total: planned.length,
          file: file.absolutePath,
          status: "completed",
        });
        return result;
      }
    },
    options.signal,
  );

  assertNotAborted(options.signal);
  const transformations = results
    .filter(
      (result) =>
        result.status === "optimized" &&
        result.outputPath &&
        result.outputPath !== result.sourcePath,
    )
    .map((result) => {
      const output = result.outputPath as string;
      const extension = output.slice(output.lastIndexOf(".") + 1).toLowerCase();
      return {
        sourcePath: result.sourcePath,
        outputPath: output,
        sourceFormat: result.original.format,
        outputFormat:
          extension === "jpg" || extension === "jpeg"
            ? ("jpeg" as const)
            : extension === "png"
              ? ("png" as const)
              : ("webp" as const),
        sourceSize: result.original.size,
        outputSize: result.outputSize ?? 0,
      };
    });

  let referencePlan;
  try {
    referencePlan = options.updateReferences
      ? await buildReferencePlan(transformations, options)
      : { filesScanned: 0, changes: [], unresolved: [] };
  } catch (error) {
    await cleanupCreatedOutputs(results, options);
    throw error;
  }

  if (options.removeOriginals && !options.dryRun) {
    if (referencePlan.filesScanned === 0) {
      await cleanupCreatedOutputs(results, options);
      throw new ImageSlimError(
        "REFERENCE_UPDATE_FAILED",
        "Cannot remove originals because no reference files were scanned.",
      );
    }
    if (referencePlan.unresolved.length > 0) {
      await cleanupCreatedOutputs(results, options);
      throw new ImageSlimError(
        "REFERENCE_UPDATE_FAILED",
        `Cannot remove originals because ${referencePlan.unresolved.length} relevant references could not be resolved.`,
      );
    }
  }

  let referenceTransaction;
  try {
    referenceTransaction = await applyReferencePlan(
      referencePlan,
      options.dryRun,
    );
  } catch (error) {
    await cleanupCreatedOutputs(results, options);
    throw error;
  }
  const referencesChanged = referenceTransaction.changed;

  if (options.removeOriginals && !options.dryRun) {
    await removeOriginalsSafely(transformations, referenceTransaction.rollback);
  }

  const originalBytes = results.reduce(
    (sum, result) => sum + result.original.size,
    0,
  );
  const outputBytes = results.reduce(
    (sum, result) => sum + (result.outputSize ?? 0),
    0,
  );
  const savedBytes = originalBytes - outputBytes;
  const report: OptimizationReport = {
    mode: options.check ? "check" : "optimize",
    dryRun: options.dryRun,
    filesScanned: discovered.length,
    optimized: results.filter((result) => result.status === "optimized").length,
    copied: results.filter((result) => result.status === "copied").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length,
    originalBytes,
    outputBytes,
    savedBytes,
    savingsPercentage:
      originalBytes === 0 ? 0 : (savedBytes / originalBytes) * 100,
    referenceFilesScanned: referencePlan.filesScanned,
    referencesChanged,
    unresolvedReferences: referencePlan.unresolved,
    results,
    durationMs: Math.round(performance.now() - started),
    config: {
      format: options.format,
      quality: options.quality,
      targetSize: options.targetSize,
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
      concurrency: options.concurrency,
      metadata: options.metadata,
      inPlace: options.inPlace,
      updateReferences: options.updateReferences,
      progress: options.progress,
      overwrite: options.overwrite,
    },
  };
  options.onProgress?.({ phase: "complete", report });
  return report;
}

async function cleanupCreatedOutputs(
  results: FileOptimizationResult[],
  options: ResolvedRunOptions,
): Promise<void> {
  if (options.dryRun || options.overwrite) return;
  await Promise.all(
    results
      .filter(
        (result) =>
          (result.status === "optimized" || result.status === "copied") &&
          result.outputPath &&
          result.outputPath !== result.sourcePath,
      )
      .map((result) => rm(result.outputPath as string, { force: true })),
  );
}

export function hasUnoptimizedFiles(report: OptimizationReport): boolean {
  return report.results.some((result) => result.status === "optimized");
}
