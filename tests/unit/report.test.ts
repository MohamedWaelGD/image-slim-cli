import { describe, expect, it } from "vitest";
import { formatTextReport } from "../../src/reporting/format";
import type { OptimizationReport } from "../../src/types/public";

function report(
  overrides: Partial<OptimizationReport> = {},
): OptimizationReport {
  return {
    mode: "optimize",
    dryRun: false,
    filesScanned: 2,
    optimized: 1,
    copied: 0,
    skipped: 1,
    failed: 0,
    originalBytes: 1_000_000,
    outputBytes: 400_000,
    savedBytes: 600_000,
    savingsPercentage: 60,
    referenceFilesScanned: 10,
    referencesChanged: 3,
    unresolvedReferences: [],
    results: [
      {
        sourcePath: "assets/hero.jpg",
        outputPath: "assets/hero.webp",
        status: "optimized",
        original: { size: 1_000_000, width: 100, height: 100, format: "jpeg" },
        optimized: { size: 400_000, width: 100, height: 100, format: "webp" },
        outputSize: 400_000,
        savingsBytes: 600_000,
        savingsPercentage: 60,
      },
      {
        sourcePath: "assets/logo.png",
        status: "skipped",
        skipReason: "optimized output was larger",
        original: { size: 5_000, width: 10, height: 10, format: "png" },
        savingsBytes: 0,
        savingsPercentage: 0,
      },
    ],
    durationMs: 1200,
    config: { removeOriginals: true, format: "webp" },
    ...overrides,
  };
}

describe("text report", () => {
  it("summarizes conversions, references, and savings", () => {
    const output = formatTextReport(report());
    expect(output).toContain("Optimize            1");
    expect(output).toContain("Convert             1");
    expect(output).toContain("Skip                1");
    expect(output).toContain("Scanned             10 files");
    expect(output).toContain("Updated             3");
    expect(output).toContain("Removed             1");
    expect(output).toContain("60.0%");
  });

  it("describes a dry run without claiming changes", () => {
    const output = formatTextReport(report({ dryRun: true }));
    expect(output).toContain("dry run");
    expect(output).toContain("Would update        3");
    expect(output).toContain("Would remove        1");
    expect(output).toContain("Estimated");
    expect(output).toContain("No files were modified.");
  });

  it("explains decisions in verbose mode", () => {
    const output = formatTextReport(report(), true);
    expect(output).toContain("+ assets/hero.jpg");
    expect(output).toContain("JPEG -> WEBP");
    expect(output).toContain("60.0% smaller");
    expect(output).toContain("- assets/logo.png");
    expect(output).toContain("optimized output was larger");
  });

  it("lists unresolved references in verbose mode", () => {
    const output = formatTextReport(
      report({
        unresolvedReferences: [
          {
            filePath: "src/app.ts",
            value: 'path.join("assets", name + ".jpg")',
            reason: "dynamic",
          },
        ],
      }),
      true,
    );
    expect(output).toContain("Unresolved          1");
    expect(output).toContain("(dynamic)");
  });
});
