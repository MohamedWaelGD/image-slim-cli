#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { loadConfig } from "./config/loader";
import { parseByteSize } from "./filesystem/size";
import { resolveOptions } from "./core/resolve-options";
import { hasUnoptimizedFiles, runOptimization } from "./core/run";
import { formatJsonReport, formatTextReport } from "./reporting/format";
import { ImageSlimError } from "./errors/image-slim-error";
import { ProgressRenderer, shouldShowProgress } from "./reporting/progress";
import type { RunOptions } from "./types/public";

declare const __IMAGE_SLIM_VERSION__: string | undefined;

const packageVersion =
  typeof __IMAGE_SLIM_VERSION__ === "string"
    ? __IMAGE_SLIM_VERSION__
    : "0.0.0-dev";

function parseNumber(value: string): number {
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new InvalidArgumentError(`Expected a number, received ${value}.`);
  return number;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("image-slim")
    .description("Optimize static image assets safely and efficiently.")
    .argument("[inputs...]", "files, directories, or glob patterns")
    .option("--out <directory>", "write results to this directory")
    .option("--overwrite", "replace existing files in the output directory")
    .option("--in-place", "write accepted results beside the source files")
    .option(
      "--remove-originals",
      "remove source files after transactional reference updates",
    )
    .option("--format <format>", "original, jpeg, png, or webp")
    .option("--quality <number>", "quality from 1 to 100", parseNumber)
    .option(
      "--target-size <size>",
      "maximum output size, for example 500kb",
      parseByteSize,
    )
    .option("--max-width <pixels>", "maximum output width", parseNumber)
    .option("--max-height <pixels>", "maximum output height", parseNumber)
    .option("--allow-upscale", "allow images to be enlarged")
    .option(
      "--background <color>",
      "background used for transparent JPEG output",
    )
    .option("--extensions <formats>", "comma-separated input extensions")
    .option(
      "--include <glob>",
      "include only matching input paths",
      collect,
      [],
    )
    .option("--exclude <glob>", "exclude matching input paths", collect, [])
    .option("--follow-symlinks", "traverse symbolic link directories")
    .option("--concurrency <number>", "maximum active image jobs", parseNumber)
    .option("--strip-metadata", "remove image metadata (default)")
    .option("--keep-metadata", "preserve image metadata")
    .option("--skip-if-larger", "skip outputs that are not smaller (default)")
    .option("--allow-larger", "accept output even when it is not smaller")
    .option(
      "--min-savings <percentage>",
      "minimum savings required to replace a file",
      parseNumber,
    )
    .option("--dry-run", "encode and report without writing files")
    .option("--check", "check assets without writing files")
    .option(
      "--fail-on-unoptimized",
      "exit 1 when check finds assets to optimize",
    )
    .option(
      "--update-references",
      "update static HTML, CSS, JS, and TS references",
    )
    .option(
      "--references <directory...>",
      "roots to search for source references",
    )
    .option("--reference-include <glob>", "reference file glob", collect, [])
    .option(
      "--reference-exclude <glob>",
      "exclude reference files",
      collect,
      [],
    )
    .option("--verbose", "print every processed file")
    .option("--quiet", "suppress text output")
    .option("--report <format>", "text or json")
    .option("--progress <mode>", "auto, always, or never")
    .option("--config <path>", "configuration file path")
    .version(packageVersion);
  return program;
}

function optionsFromCommand(options: Record<string, unknown>): RunOptions {
  if (options.keepMetadata && options.stripMetadata) {
    throw new InvalidArgumentError(
      "--keep-metadata cannot be used with --strip-metadata.",
    );
  }
  if (options.skipIfLarger && options.allowLarger) {
    throw new InvalidArgumentError(
      "--skip-if-larger cannot be used with --allow-larger.",
    );
  }
  const result: RunOptions = {
    output: options.out as string | undefined,
    overwrite: options.overwrite as boolean | undefined,
    inPlace: options.inPlace as boolean | undefined,
    removeOriginals: options.removeOriginals as boolean | undefined,
    format: options.format as RunOptions["format"],
    quality: options.quality as number | undefined,
    targetSize: options.targetSize as number | undefined,
    maxWidth: options.maxWidth as number | undefined,
    maxHeight: options.maxHeight as number | undefined,
    allowUpscale: options.allowUpscale as boolean | undefined,
    background: options.background as string | undefined,
    extensions: options.extensions
      ? String(options.extensions).split(",")
      : undefined,
    include: options.include as string[] | undefined,
    exclude: options.exclude as string[] | undefined,
    followSymlinks: options.followSymlinks as boolean | undefined,
    concurrency: options.concurrency as number | undefined,
    metadata: options.keepMetadata
      ? "keep"
      : options.stripMetadata
        ? "strip"
        : undefined,
    skipIfLarger: options.skipIfLarger as boolean | undefined,
    allowLarger: options.allowLarger as boolean | undefined,
    minSavingsPercentage: options.minSavings as number | undefined,
    dryRun: options.dryRun as boolean | undefined,
    check: options.check as boolean | undefined,
    failOnUnoptimized: options.failOnUnoptimized as boolean | undefined,
    updateReferences: options.updateReferences as boolean | undefined,
    references: {
      roots: options.references as string[] | undefined,
      include: options.referenceInclude as string[] | undefined,
      exclude: options.referenceExclude as string[] | undefined,
    },
    verbose: options.verbose as boolean | undefined,
    report: options.report as RunOptions["report"],
    progress: options.progress as RunOptions["progress"],
    config: options.config as string | undefined,
  };
  return result;
}

export async function main(argv = process.argv): Promise<number> {
  const program = createProgram();
  let resultCode = 0;
  program.exitOverride();
  program.action(async (inputs: string[], options: Record<string, unknown>) => {
    const cliOptions = optionsFromCommand(options);
    const controller = new AbortController();
    const onSignal = (): void => {
      controller.abort(new Error("Interrupted by signal."));
    };
    let progress: ProgressRenderer | undefined;
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
      const loaded = await loadConfig(cliOptions.config);
      const resolved = resolveOptions(loaded.config, {
        ...cliOptions,
        inputs,
        signal: controller.signal,
      });
      if (
        shouldShowProgress(
          resolved.progress,
          resolved.report,
          Boolean(options.quiet),
          process.stderr.isTTY,
        )
      ) {
        progress = new ProgressRenderer(process.stderr);
        progress.start();
        resolved.onProgress = progress.handle;
      }
      const report = await runOptimization(resolved);
      progress?.stop();
      progress = undefined;
      if (resolved.report === "json") {
        process.stdout.write(`${formatJsonReport(report)}\n`);
      } else if (!options.quiet) {
        process.stdout.write(
          `${formatTextReport(report, Boolean(options.verbose))}\n`,
        );
      }
      if (report.failed > 0) {
        resultCode = 3;
      } else if (
        resolved.check &&
        resolved.failOnUnoptimized &&
        hasUnoptimizedFiles(report)
      ) {
        resultCode = 1;
      }
    } finally {
      progress?.stop();
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
  });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version"
      )
        return 0;
      return 2;
    }
    const normalized =
      error instanceof ImageSlimError ? error : new Error(String(error));
    process.stderr.write(`${normalized.message}\n`);
    if (
      normalized instanceof ImageSlimError &&
      normalized.code === "INVALID_OPTIONS"
    )
      return 2;
    return normalized instanceof ImageSlimError && normalized.code === "ABORTED"
      ? 130
      : 3;
  }
  return resultCode;
}
