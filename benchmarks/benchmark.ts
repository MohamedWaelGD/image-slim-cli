/**
 * Reproducible performance and memory benchmarks for image-slim-cli.
 *
 * Usage:
 *   npm run bench
 *   npm run bench -- --workload normal --concurrency 1,2,4
 *   npm run bench -- --regenerate
 *
 * Fixtures live in benchmarks/fixtures and are generated on first use.
 */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { optimizeDirectory } from "../src/index";
import type { OptimizationReport } from "../src/types/public";

type FixtureFormat = "jpeg" | "png" | "webp";

interface FixtureGroup {
  count: number;
  width: number;
  height: number;
  format: FixtureFormat;
  quality: number;
}

const WORKLOADS: Record<string, FixtureGroup[]> = {
  small: [{ count: 100, width: 256, height: 256, format: "jpeg", quality: 85 }],
  normal: [
    { count: 100, width: 1024, height: 768, format: "jpeg", quality: 90 },
  ],
  large: [
    { count: 10, width: 3000, height: 2000, format: "jpeg", quality: 92 },
  ],
  mixed: [
    { count: 30, width: 1024, height: 768, format: "jpeg", quality: 90 },
    { count: 30, width: 800, height: 600, format: "png", quality: 100 },
    { count: 40, width: 640, height: 480, format: "webp", quality: 90 },
  ],
};

interface Measurement {
  workload: string;
  concurrency: number;
  images: number;
  durationMs: number;
  imagesPerSecond: number;
  peakRssBytes: number;
  inputBytes: number;
  outputBytes: number;
  savingsPercentage: number;
  optimized: number;
  skipped: number;
  failed: number;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function extensionFor(format: FixtureFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

async function generateFixtures(
  directory: string,
  groups: FixtureGroup[],
): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const group of groups) {
    for (let index = 0; index < group.count; index += 1) {
      const fileName = `${group.format}-${group.width}x${group.height}-${String(index).padStart(3, "0")}.${extensionFor(group.format)}`;
      const file = join(directory, fileName);
      const raw = randomBytes(group.width * group.height * 3);
      const pipeline = sharp(raw, {
        raw: { width: group.width, height: group.height, channels: 3 },
      });
      if (group.format === "jpeg") {
        await pipeline.jpeg({ quality: group.quality }).toFile(file);
      } else if (group.format === "png") {
        await pipeline.png().toFile(file);
      } else {
        await pipeline.webp({ quality: group.quality }).toFile(file);
      }
    }
  }
}

async function measure(
  workload: string,
  input: string,
  concurrency: number,
  output: string,
): Promise<Measurement> {
  await rm(output, { recursive: true, force: true });
  let peakRssBytes = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 25);

  const started = performance.now();
  let report: OptimizationReport;
  try {
    report = await optimizeDirectory(input, {
      output,
      format: "webp",
      quality: 80,
      minSavingsPercentage: 0,
      concurrency,
      progress: "never",
    });
  } finally {
    clearInterval(sampler);
  }
  const durationMs = performance.now() - started;

  const inputBytes = (
    await Promise.all(
      report.results.map(
        async (result) => (await stat(result.sourcePath)).size,
      ),
    )
  ).reduce((sum, size) => sum + size, 0);

  return {
    workload,
    concurrency,
    images: report.filesScanned,
    durationMs,
    imagesPerSecond:
      durationMs === 0 ? 0 : report.filesScanned / (durationMs / 1000),
    peakRssBytes,
    inputBytes,
    outputBytes: report.outputBytes,
    savingsPercentage: report.savingsPercentage,
    optimized: report.optimized,
    skipped: report.skipped,
    failed: report.failed,
  };
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function printTable(rows: Measurement[]): void {
  const header = [
    "workload",
    "conc",
    "images",
    "seconds",
    "img/s",
    "peak RSS",
    "input",
    "output",
    "saved",
    "ok",
    "skip",
    "fail",
  ];
  const body = rows.map((row) => [
    row.workload,
    String(row.concurrency),
    String(row.images),
    (row.durationMs / 1000).toFixed(2),
    row.imagesPerSecond.toFixed(1),
    megabytes(row.peakRssBytes),
    megabytes(row.inputBytes),
    megabytes(row.outputBytes),
    `${row.savingsPercentage.toFixed(1)}%`,
    String(row.optimized),
    String(row.skipped),
    String(row.failed),
  ]);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...body.map((row) => row[index]?.length ?? 0)),
  );
  const render = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
  console.log(render(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of body) console.log(render(row));
}

async function main(): Promise<void> {
  const fixtureRoot = join(process.cwd(), "benchmarks", "fixtures");
  const outputRoot = await mkdtemp(join(tmpdir(), "image-slim-bench-out-"));
  const selected = (argument("--workload") ?? Object.keys(WORKLOADS).join(","))
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const concurrencies = (argument("--concurrency") ?? "1,2,4,8")
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  const regenerate = process.argv.includes("--regenerate");

  for (const name of selected) {
    if (!WORKLOADS[name]) {
      throw new Error(
        `Unknown workload "${name}". Available: ${Object.keys(WORKLOADS).join(", ")}.`,
      );
    }
  }

  const rows: Measurement[] = [];
  try {
    for (const name of selected) {
      const groups = WORKLOADS[name] as FixtureGroup[];
      const directory = join(fixtureRoot, name);
      const expected = groups.reduce((sum, group) => sum + group.count, 0);
      let present = 0;
      try {
        present = (await readdir(directory)).length;
      } catch {
        present = 0;
      }
      if (regenerate || present < expected) {
        console.log(`Generating "${name}" fixtures (${expected} images)...`);
        await rm(directory, { recursive: true, force: true });
        await generateFixtures(directory, groups);
      }

      for (const concurrency of concurrencies) {
        console.log(
          `\nBenchmarking "${name}" at concurrency ${concurrency}...`,
        );
        rows.push(
          await measure(
            name,
            directory,
            concurrency,
            join(outputRoot, `${name}-c${concurrency}`),
          ),
        );
      }
    }
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }

  console.log("\nResults\n");
  printTable(rows);
  console.log(
    "\nPeak RSS includes the benchmark process itself. Compare values across concurrency settings rather than treating them as absolute.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
