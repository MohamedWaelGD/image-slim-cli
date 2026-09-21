import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { ImageSlimError } from "../errors/image-slim-error";
import {
  commonPath,
  ensureContained,
  makeRelativePath,
  pathForFormat,
  pathIdentity,
} from "./paths";
import type { DiscoveredFile } from "./discovery";
import type { ImageFormat } from "../types/public";
import type { ResolvedRunOptions } from "../core/types";

export interface PlannedFile extends DiscoveredFile {
  outputPath: string;
  format: ImageFormat;
}

export function planOutputs(
  files: DiscoveredFile[],
  options: ResolvedRunOptions,
): PlannedFile[] {
  const roots = [...new Set(files.map((file) => file.root))];
  const root = commonPath(roots);
  const seen = new Set<string>();

  return files.map((file) => {
    const relativePath = makeRelativePath(file.absolutePath, root);
    const requestedFormat = options.format;
    const outputPath = options.inPlace
      ? requestedFormat === "original"
        ? file.absolutePath
        : pathForFormat(file.absolutePath, requestedFormat)
      : requestedFormat === "original"
        ? resolve(options.output, relativePath)
        : pathForFormat(resolve(options.output, relativePath), requestedFormat);

    if (!options.inPlace) ensureContained(options.output, outputPath);
    if (
      !options.inPlace &&
      pathIdentity(outputPath) === pathIdentity(file.absolutePath)
    ) {
      throw new ImageSlimError(
        "OUTPUT_COLLISION",
        `Output would overwrite the input file: ${outputPath}`,
      );
    }
    const key = pathIdentity(outputPath);
    if (seen.has(key)) {
      throw new ImageSlimError(
        "OUTPUT_COLLISION",
        `Multiple inputs map to the same output: ${outputPath}`,
      );
    }
    seen.add(key);

    return { ...file, outputPath, format: requestedFormat };
  });
}

export async function validateOutputPlan(
  files: PlannedFile[],
  options: ResolvedRunOptions,
): Promise<void> {
  for (const file of files) {
    if (
      options.inPlace &&
      pathIdentity(file.outputPath) === pathIdentity(file.absolutePath)
    )
      continue;
    if (!options.inPlace && (options.overwrite || options.dryRun)) continue;
    try {
      await access(file.outputPath);
      throw new ImageSlimError(
        "OUTPUT_COLLISION",
        options.inPlace
          ? `Output already exists and cannot be replaced safely: ${file.outputPath}`
          : `Output already exists. Use --overwrite to replace it: ${file.outputPath}`,
      );
    } catch (error) {
      if (error instanceof ImageSlimError) throw error;
    }
  }
}
