export type ImageFormat = "original" | "jpeg" | "png" | "webp";
export type MetadataMode = "strip" | "keep";
export type ReportFormat = "text" | "json";
export type ProgressMode = "auto" | "always" | "never";
export type FileResultStatus = "optimized" | "copied" | "skipped" | "failed";

export type ProgressEvent =
  | { phase: "discovering" }
  | { phase: "discovered"; total: number }
  | {
      phase: "optimizing";
      completed: number;
      total: number;
      file: string;
      status: "started" | "completed";
    }
  | { phase: "references"; completed: number; total: number; file: string }
  | { phase: "complete"; report: OptimizationReport };

export type ProgressHandler = (event: ProgressEvent) => void;

export interface ReferenceOptions {
  update?: boolean;
  roots?: string[];
  include?: string[];
  exclude?: string[];
}

export interface OptimizationOptions {
  format?: ImageFormat;
  quality?: number;
  targetSize?: number | string;
  maxWidth?: number;
  maxHeight?: number;
  allowUpscale?: boolean;
  background?: string;
  metadata?: MetadataMode;
  skipIfLarger?: boolean;
  minSavingsPercentage?: number;
  allowLarger?: boolean;
  inPlace?: boolean;
  concurrency?: number;
  followSymlinks?: boolean;
  removeOriginals?: boolean;
  updateReferences?: boolean;
  references?: ReferenceOptions;
  dryRun?: boolean;
  check?: boolean;
  failOnUnoptimized?: boolean;
  verbose?: boolean;
  report?: ReportFormat;
  progress?: ProgressMode;
  overwrite?: boolean;
  onProgress?: ProgressHandler;
  signal?: AbortSignal;
}

export interface RunOptions extends OptimizationOptions {
  inputs?: string[];
  output?: string;
  include?: string[];
  exclude?: string[];
  extensions?: string[];
  config?: string;
}

export interface ImageMetadata {
  size: number;
  width: number;
  height: number;
  format: string;
  hasAlpha?: boolean;
  orientation?: number;
}

export interface AssetTransformation {
  sourcePath: string;
  outputPath: string;
  sourceFormat: string;
  outputFormat: Exclude<ImageFormat, "original">;
  sourceSize: number;
  outputSize: number;
}

export interface ReferenceChange {
  filePath: string;
  start: number;
  end: number;
  before: string;
  after: string;
}

export interface UnresolvedReference {
  filePath: string;
  value: string;
  reason: "dynamic" | "not-found" | "ambiguous" | "unsupported";
}

export interface FileOptimizationResult {
  sourcePath: string;
  outputPath?: string;
  status: FileResultStatus;
  original: ImageMetadata;
  optimized?: ImageMetadata;
  outputSize?: number;
  quality?: number;
  targetSizeReached?: boolean;
  savingsBytes: number;
  savingsPercentage: number;
  error?: { code: string; message: string };
}

export interface OptimizationReport {
  mode: "optimize" | "check";
  dryRun: boolean;
  filesScanned: number;
  optimized: number;
  copied: number;
  skipped: number;
  failed: number;
  originalBytes: number;
  outputBytes: number;
  savedBytes: number;
  savingsPercentage: number;
  referenceFilesScanned: number;
  referencesChanged: number;
  unresolvedReferences: UnresolvedReference[];
  results: FileOptimizationResult[];
  durationMs: number;
  config: Record<string, unknown>;
}

export interface CheckResult {
  report: OptimizationReport;
  hasUnoptimizedFiles: boolean;
}

export interface ImageSlimConfig extends RunOptions {
  input?: string | string[];
}

export function defineConfig(config: ImageSlimConfig): ImageSlimConfig {
  return config;
}
