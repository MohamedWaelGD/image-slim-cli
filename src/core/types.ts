import type {
  ImageSlimConfig,
  ImageFormat,
  ProgressHandler,
  ProgressMode,
  ReferenceOptions,
} from "../types/public";

export interface ResolvedRunOptions {
  inputs: string[];
  output: string;
  format: ImageFormat;
  quality: number;
  minQuality: number;
  targetSize?: number;
  maxWidth?: number;
  maxHeight?: number;
  allowUpscale: boolean;
  background: string;
  metadata: "strip" | "keep";
  skipIfLarger: boolean;
  allowLarger: boolean;
  minSavingsPercentage: number;
  concurrency: number;
  followSymlinks: boolean;
  inPlace: boolean;
  removeOriginals: boolean;
  updateReferences: boolean;
  include: string[];
  exclude: string[];
  extensions?: string[];
  references: ReferenceOptions;
  dryRun: boolean;
  check: boolean;
  failOnUnoptimized: boolean;
  failOnTargetSize: boolean;
  verbose: boolean;
  report: "text" | "json";
  progress: ProgressMode;
  overwrite: boolean;
  onProgress?: ProgressHandler;
  signal?: AbortSignal;
  cwd: string;
}

export function toOptimizationOptions(options: ResolvedRunOptions) {
  return {
    format: options.format,
    quality: options.quality,
    minQuality: options.minQuality,
    targetSize: options.targetSize,
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
    allowUpscale: options.allowUpscale,
    background: options.background,
    metadata: options.metadata,
    signal: options.signal,
  };
}

export type ConfigLike = ImageSlimConfig & { inputs?: string[] };
