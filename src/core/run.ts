import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { discoverFiles } from "../filesystem/discovery";
import {
  planOutputs,
  validateOutputPlan,
  type PlannedFile,
} from "../filesystem/output-plan";
import { pathIdentity } from "../filesystem/paths";
import { removeOriginalsSafely } from "../filesystem/originals";
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

/**
 * Delete outputs created by this run. Files that already existed before the
 * run are never touched so rollback cannot destroy a user's data.
 */
async function cleanupCreatedOutputs(
  results: FileOptimizationResult[],
  options: ResolvedRunOptions,
  preExisting: Set<string>,
): Promise<void> {
  if (options.dryRun) return;
  await Promise.all(
    results
      .filter(
        (result) =>
          (result.status === "optimized" || result.status === "copied") &&
          result.outputPath &&
          result.outputPath !== result.sourcePath &&
          !preExisting.has(pathIdentity(result.outputPath)),
      )
      .map((result) => rm(result.outputPath as string, { force: true })),
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
  const { preExisting } = await validateOutputPlan(planned, options);

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

  const destructive = options.removeOriginals && !options.dryRun;
  const cleanup = (): Promise<void> =>
    cleanupCreatedOutputs(results, options, preExisting);

  try {
    assertNotAborted(options.signal);

    if (destructive) {
      const failures = results.filter((result) => result.status === "failed");
      if (failures.length > 0) {
        throw new ImageSlimError(
          "ENCODE_FAILED",
          `Cannot remove originals because ${failures.length} image(s) failed to optimize.`,
        );
      }
    }

    const transformations = results
      .filter(
        (result) =>
          result.status === "optimized" &&
          result.outputPath &&
          result.outputPath !== result.sourcePath,
      )
      .map((result) => {
        const output = result.outputPath as string;
        const extension = output
          .slice(output.lastIndexOf(".") + 1)
          .toLowerCase();
        return {
          sourcePath: result.sourcePath,
          outputPath: output,
          sourceFormat: result.original.format,
          outputFormat:
            extension === "jpg" || extension === "jpeg"
              ? ("jpeg" as const)
              : extension === "png"
                ? ("png" as const)
                : extension === "avif"
                  ? ("avif" as const)
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
      await cleanup();
      throw error;
    }

    if (destructive) {
      if (referencePlan.filesScanned === 0) {
        throw new ImageSlimError(
          "REFERENCE_UPDATE_FAILED",
          "Cannot remove originals because no reference files were scanned.",
        );
      }
      if (referencePlan.unresolved.length > 0) {
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
        options.cwd,
      );
    } catch (error) {
      await cleanup();
      throw error;
    }
    const referencesChanged = referenceTransaction.changed;

    if (destructive) {
      await removeOriginalsSafely(
        transformations,
        referenceTransaction.rollback,
      );
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
      optimized: results.filter((result) => result.status === "optimized")
        .length,
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
        minQuality: options.minQuality,
        targetSize: options.targetSize,
        maxWidth: options.maxWidth,
        maxHeight: options.maxHeight,
        concurrency: options.concurrency,
        metadata: options.metadata,
        inPlace: options.inPlace,
        updateReferences: options.updateReferences,
        removeOriginals: options.removeOriginals,
        progress: options.progress,
        overwrite: options.overwrite,
        failOnTargetSize: options.failOnTargetSize,
      },
    };
    options.onProgress?.({ phase: "complete", report });
    return report;
  } catch (error) {
    // A destructive migration must never leave generated output behind when it
    // aborts for any reason.
    if (destructive) await cleanup();
    throw error;
  }
}

export function hasUnoptimizedFiles(report: OptimizationReport): boolean {
  return report.results.some((result) => result.status === "optimized");
}
