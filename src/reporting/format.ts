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

function resultLine(result: FileOptimizationResult): string {
  const path = relativeDisplay(result.sourcePath);
  if (result.status === "failed")
    return `[FAIL] ${path}\n  ${result.error?.message ?? "Unknown error"}`;
  if (result.status === "skipped")
    return `- ${path}\n  skipped (${formatBytes(result.original.size)})`;
  if (result.status === "copied")
    return `[COPY] ${path}\n  already optimized (${formatBytes(result.original.size)})`;
  return `[OK] ${path}\n  ${formatBytes(result.original.size)} -> ${formatBytes(result.outputSize ?? 0)}   -${percentage(Math.max(0, result.savingsPercentage))}`;
}

export function formatTextReport(
  report: OptimizationReport,
  verbose = false,
): string {
  const lines = [
    report.mode === "check" ? "Image Slim Check" : "Image Slim",
    report.dryRun ? "No files were modified." : "",
    "",
    `Files scanned       ${report.filesScanned}`,
    `Optimized           ${report.optimized}`,
    `Copied              ${report.copied}`,
    `Skipped             ${report.skipped}`,
    `Failed              ${report.failed}`,
    "",
    `Before              ${formatBytes(report.originalBytes)}`,
    `After               ${formatBytes(report.outputBytes)}`,
    `Saved               ${formatBytes(report.savedBytes)} (${percentage(report.savingsPercentage)})`,
  ];

  if (report.referenceFilesScanned > 0 || report.referencesChanged > 0) {
    lines.push(
      "",
      `Reference files      ${report.referenceFilesScanned}`,
      `References changed  ${report.referencesChanged}`,
    );
  }
  if (report.unresolvedReferences.length > 0) {
    lines.push(
      "",
      `Unresolved references ${report.unresolvedReferences.length}`,
    );
    if (verbose) {
      for (const reference of report.unresolvedReferences) {
        lines.push(
          `  ${relativeDisplay(reference.filePath)}: ${reference.value} (${reference.reason})`,
        );
      }
    }
  }
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
    `Completed in         ${(report.durationMs / 1000).toFixed(2)}s`,
  );

  if (verbose) {
    lines.splice(2, 0, "", ...report.results.map(resultLine), "");
  }
  return lines
    .filter((line, index) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}

export function formatJsonReport(report: OptimizationReport): string {
  return JSON.stringify(report, null, 2);
}
