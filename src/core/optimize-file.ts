import { encodeImage, inspectImage } from "../image/engine";
import { copyAtomic, writeAtomic } from "../filesystem/atomic";
import { ImageSlimError } from "../errors/image-slim-error";
import { normalizeImageFormat } from "../image/formats";
import type { FileOptimizationResult } from "../types/public";
import type { PlannedFile } from "../filesystem/output-plan";
import type { ResolvedRunOptions } from "./types";
import { toOptimizationOptions } from "./types";

function savings(
  original: number,
  output: number,
): { bytes: number; percentage: number } {
  const bytes = original - output;
  return { bytes, percentage: original === 0 ? 0 : (bytes / original) * 100 };
}

type SkipDecision = { skip: true; reason: string } | { skip: false };

function shouldSkip(
  original: number,
  output: number,
  options: ResolvedRunOptions,
): SkipDecision {
  if (options.allowLarger) return { skip: false };
  if (options.skipIfLarger && output >= original)
    return { skip: true, reason: "optimized output was larger" };
  const percentage = savings(original, output).percentage;
  if (percentage < options.minSavingsPercentage)
    return {
      skip: true,
      reason: `savings below the ${options.minSavingsPercentage}% minimum`,
    };
  return { skip: false };
}

function outputBoundary(
  file: PlannedFile,
  options: ResolvedRunOptions,
): string {
  return options.inPlace ? file.root : options.output;
}

export async function optimizeFile(
  file: PlannedFile,
  options: ResolvedRunOptions,
): Promise<FileOptimizationResult> {
  try {
    if (options.signal?.aborted) {
      throw new ImageSlimError(
        "ABORTED",
        "Image optimization was interrupted.",
        {
          cause: options.signal.reason,
        },
      );
    }
    const encoded = await encodeImage(
      file.absolutePath,
      toOptimizationOptions(options),
    );
    const reduction = savings(
      encoded.input.size,
      encoded.output.data.byteLength,
    );
    const decision = shouldSkip(
      encoded.input.size,
      encoded.output.data.byteLength,
      options,
    );

    if (decision.skip) {
      const conversionSkipped =
        options.format !== "original" &&
        normalizeImageFormat(encoded.input.format) !== options.format;
      if (options.signal?.aborted) {
        throw new ImageSlimError(
          "ABORTED",
          "Image optimization was interrupted.",
          { cause: options.signal.reason },
        );
      }
      const boundary = outputBoundary(file, options);
      if (!conversionSkipped && !options.inPlace && !options.dryRun) {
        await copyAtomic(file.absolutePath, file.outputPath, {
          overwrite: options.overwrite,
          boundary,
        });
      }
      const skipped = options.inPlace || conversionSkipped;
      return {
        sourcePath: file.absolutePath,
        outputPath: skipped ? undefined : file.outputPath,
        status: skipped ? "skipped" : "copied",
        skipReason: skipped
          ? options.inPlace
            ? "in-place optimization did not produce a smaller file"
            : "format conversion was not beneficial"
          : undefined,
        original: encoded.input,
        optimized: encoded.input,
        outputSize: encoded.input.size,
        savingsBytes: 0,
        savingsPercentage: 0,
        targetSizeReached: encoded.output.targetSizeReached,
        quality: encoded.output.quality,
      };
    }

    if (options.signal?.aborted) {
      throw new ImageSlimError(
        "ABORTED",
        "Image optimization was interrupted.",
        {
          cause: options.signal.reason,
        },
      );
    }
    if (!options.dryRun) {
      await writeAtomic(file.outputPath, encoded.output.data, {
        overwrite:
          options.overwrite ||
          (options.inPlace && file.outputPath === file.absolutePath),
        boundary: outputBoundary(file, options),
      });
    }
    return {
      sourcePath: file.absolutePath,
      outputPath: file.outputPath,
      status: "optimized",
      original: encoded.input,
      optimized: encoded.output.metadata,
      outputSize: encoded.output.data.byteLength,
      savingsBytes: reduction.bytes,
      savingsPercentage: reduction.percentage,
      targetSizeReached: encoded.output.targetSizeReached,
      quality: encoded.output.quality,
    };
  } catch (error) {
    if (error instanceof ImageSlimError && error.code === "ANIMATED_IMAGE") {
      const original = await inspectImage(file.absolutePath);
      return {
        sourcePath: file.absolutePath,
        status: "skipped",
        original,
        savingsBytes: 0,
        savingsPercentage: 0,
        skipReason: error.message,
      };
    }
    if (error instanceof ImageSlimError) throw error;
    throw new ImageSlimError(
      "ENCODE_FAILED",
      `Unable to optimize image: ${file.absolutePath}`,
      { cause: error },
    );
  }
}
