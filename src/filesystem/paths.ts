import {
  basename,
  dirname,
  extname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { ImageSlimError } from "../errors/image-slim-error";
import type { ImageFormat } from "../types/public";

const GLOB_MARKERS = /[*?{}[\]!()]/;

export function isGlobPattern(value: string): boolean {
  return GLOB_MARKERS.test(value);
}

export function normalizeExtension(value: string): string {
  const extension = value.startsWith(".") ? value : `.${value}`;
  return extension.toLowerCase();
}

export function normalizeExtensions(values: string[] | undefined): string[] {
  return (values ?? ["jpg", "jpeg", "png", "webp", "avif"]).map(
    normalizeExtension,
  );
}

export function commonPath(paths: string[]): string {
  if (paths.length === 0) return process.cwd();
  const parts = paths.map((item) => resolve(item).split(/[\\/]+/));
  const first = parts[0] ?? [];
  let length = first.length;
  for (const current of parts.slice(1)) {
    length = Math.min(length, current.length);
    for (let index = 0; index < length; index += 1) {
      if (first[index]?.toLowerCase() !== current[index]?.toLowerCase()) {
        length = index;
        break;
      }
    }
  }

  const prefix = first.slice(0, length).join(sep);
  return prefix || parseRoot(paths[0] ?? process.cwd());
}

function parseRoot(value: string): string {
  const resolved = resolve(value);
  return resolved.split(/[\\/]+/)[0] ?? resolved;
}

export function pathForFormat(
  path: string,
  format: Exclude<ImageFormat, "original">,
): string {
  const extension = format === "jpeg" ? ".jpg" : `.${format}`;
  return `${path.slice(0, path.length - extname(path).length)}${extension}`;
}

export function makeRelativePath(filePath: string, root: string): string {
  const value = relative(root, filePath);
  return value || basename(filePath);
}

export function ensureContained(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relativePath = relative(resolvedRoot, resolvedCandidate);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new ImageSlimError(
      "OUTPUT_UNSAFE",
      `Output path escapes the output directory: ${candidate}`,
    );
  }
}

export function pathIdentity(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function toPortablePath(value: string): string {
  return normalize(value).split(sep).join("/");
}

export function staticGlobBase(pattern: string, cwd = process.cwd()): string {
  const normalized = pattern.replaceAll("\\", "/");
  const markerIndex = normalized.search(GLOB_MARKERS);
  const prefix =
    markerIndex === -1 ? normalized : normalized.slice(0, markerIndex);
  const directory = prefix.endsWith("/")
    ? prefix.slice(0, -1)
    : dirname(prefix);
  return resolve(cwd, directory || ".");
}
