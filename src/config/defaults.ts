import type { ImageSlimConfig, OptimizationOptions } from "../types/public";

export const DEFAULT_INPUT_IGNORES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.angular/**",
  "**/coverage/**",
];

export const DEFAULT_REFERENCE_INCLUDE = [
  "**/*.{html,htm,css,scss,sass,less,js,jsx,ts,tsx}",
];

export const DEFAULT_REFERENCE_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/*.map",
  "**/*.min.js",
  "**/*.spec.{js,jsx,ts,tsx}",
  "**/*.test.{js,jsx,ts,tsx}",
];

export const DEFAULT_OPTIONS: Required<
  Pick<
    OptimizationOptions,
    | "format"
    | "quality"
    | "allowUpscale"
    | "background"
    | "metadata"
    | "skipIfLarger"
    | "minSavingsPercentage"
    | "allowLarger"
    | "inPlace"
    | "concurrency"
    | "followSymlinks"
    | "dryRun"
    | "check"
    | "failOnUnoptimized"
    | "verbose"
    | "report"
    | "progress"
    | "overwrite"
    | "updateReferences"
  >
> = {
  format: "original",
  quality: 82,
  allowUpscale: false,
  background: "#ffffff",
  metadata: "strip",
  skipIfLarger: true,
  minSavingsPercentage: 5,
  allowLarger: false,
  inPlace: false,
  concurrency: 2,
  followSymlinks: false,
  dryRun: false,
  check: false,
  failOnUnoptimized: false,
  verbose: false,
  report: "text",
  progress: "auto",
  overwrite: false,
  updateReferences: false,
};

export const DEFAULT_CONFIG: ImageSlimConfig = {
  ...DEFAULT_OPTIONS,
  exclude: [...DEFAULT_INPUT_IGNORES],
  references: {
    update: false,
    include: [...DEFAULT_REFERENCE_INCLUDE],
    exclude: [...DEFAULT_REFERENCE_EXCLUDE],
  },
};

export const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

/**
 * Upper bound for user-configured concurrency. Decoded images can be tens of
 * megabytes each, so an unbounded worker count is a denial-of-service risk.
 */
export const MAX_CONCURRENCY = 64;
