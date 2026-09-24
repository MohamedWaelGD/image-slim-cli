import { formatBytes } from "../filesystem/size";
import type {
  FileOptimizationResult,
  OptimizationReport,
} from "../types/public";

function percentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

function relativeDisplay(path: string): string {
  return path.replaceAll("\\", "/");
}

function formatLabel(format: string | undefined): string | undefined {
  if (!format || format === "unknown") return undefined;
  const normalized = format.toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return "JPEG";
  return normalized.toUpperCase();
}

function counts(report: OptimizationReport) {
  const optimized = report.results.filter(
    (result) => result.status === "optimized",
  );
  const converted = optimized.filter((result) => {
    const before = formatLabel(result.original.format);
    const after = formatLabel(result.optimized?.format);
    return Boolean(after && before !== after);
  });
  return {
    optimized: optimized.length,
    converted: converted.length,
    copied: report.results.filter((result) => result.status === "copied")
      .length,
    skipped: report.results.filter((result) => result.status === "skipped")
      .length,
    failed: report.results.filter((result) => result.status === "failed")
      .length,
  };
}

function resultLines(result: FileOptimizationResult): string[] {
  const path = relativeDisplay(result.sourcePath);
  if (result.status === "failed") {
    return [`! ${path}`, `  ${result.error?.message ?? "Unknown error"}`];
  }
  if (result.status === "skipped") {
    return [
      `- ${path}`,
      `  skipped: ${result.skipReason ?? "not beneficial"} (${formatBytes(result.original.size)})`,
    ];
  }
  if (result.status === "copied") {
    return [
      `= ${path}`,
      `  copied unchanged: already optimal (${formatBytes(result.original.size)})`,
    ];
  }
  const lines = [
    `+ ${path}`,
    `  ${formatBytes(result.original.size)} -> ${formatBytes(result.outputSize ?? 0)}`,
  ];
  const source = formatLabel(result.original.format);
  const target = formatLabel(result.optimized?.format);
  if (source && target && source !== target)
    lines.push(`  ${source} -> ${target}`);
  lines.push(`  ${percentage(Math.max(0, result.savingsPercentage))} smaller`);
  return lines;
}

export function formatTextReport(
  report: OptimizationReport,
  verbose = false,
): string {
  const totals = counts(report);
  const removeOriginals = report.config?.removeOriginals === true;
  const lines: string[] = [
    report.dryRun
      ? report.mode === "check"
        ? "Image Slim Check"
        : "Image Slim (dry run)"
      : report.mode === "check"
        ? "Image Slim Check"
        : "Image Slim",
  ];

  if (verbose) {
    lines.push("", ...report.results.flatMap(resultLines), "");
  }
  const missedTargets = report.results.filter(
    (result) => result.targetSizeReached === false,
  );

  lines.push(
    "Found               " + report.filesScanned,
    "",
    "Optimize            " + totals.optimized,
    "Convert             " + totals.converted,
    "Copy                " + totals.copied,
    "Skip                " + totals.skipped,
    "Failed              " + totals.failed,
  );
  if (missedTargets.length > 0) {
    lines.push("Target size missed  " + missedTargets.length);
    for (const result of missedTargets) {
      lines.push(
        `  ${relativeDisplay(result.sourcePath)}: could not encode below the target size`,
      );
    }
  }

  if (
    report.referenceFilesScanned > 0 ||
    report.referencesChanged > 0 ||
    report.unresolvedReferences.length > 0
  ) {
    lines.push(
      "",
      "References",
      "Scanned             " + report.referenceFilesScanned + " files",
      (report.dryRun ? "Would update        " : "Updated             ") +
        report.referencesChanged,
      "Unresolved          " + report.unresolvedReferences.length,
    );
    if (verbose) {
      for (const reference of report.unresolvedReferences) {
        lines.push(
          `  ${relativeDisplay(reference.filePath)}: ${reference.value} (${reference.reason})`,
        );
      }
    }
  }

  if (removeOriginals) {
    lines.push(
      "",
      "Originals",
      (report.dryRun ? "Would remove        " : "Removed             ") +
        totals.converted,
    );
  }

  lines.push(
    "",
    report.dryRun ? "Estimated" : "Result",
    "Original            " + formatBytes(report.originalBytes),
    "Optimized           " + formatBytes(report.outputBytes),
    "Saved               " +
      formatBytes(report.savedBytes) +
      ` (${percentage(report.savingsPercentage)})`,
  );

  const failures = report.results.filter(
    (result) => result.status === "failed",
  );
  if (failures.length > 0 && !verbose) {
    lines.push("", "Failures");
    for (const failure of failures) {
      lines.push(
        `  ${relativeDisplay(failure.sourcePath)}: ${failure.error?.message ?? "Unknown error"}`,
      );
    }
  }

  lines.push(
    "",
    `Completed in        ${(report.durationMs / 1000).toFixed(2)}s`,
  );

  if (report.dryRun) lines.push("", "No files were modified.");

  return lines.join("\n");
}

export function formatJsonReport(report: OptimizationReport): string {
  return JSON.stringify(report, null, 2);
}
