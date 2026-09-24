import { readFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import fg from "fast-glob";
import {
  DEFAULT_REFERENCE_EXCLUDE,
  DEFAULT_REFERENCE_INCLUDE,
} from "../config/defaults";
import { readText, writeTextAtomic } from "../filesystem/atomic";
import { ImageSlimError } from "../errors/image-slim-error";
import { pathIdentity, toPortablePath } from "../filesystem/paths";
import type {
  AssetTransformation,
  ReferenceChange,
  UnresolvedReference,
} from "../types/public";
import type { ResolvedRunOptions } from "../core/types";

export interface ReferencePlan {
  filesScanned: number;
  changes: ReferenceChange[];
  unresolved: UnresolvedReference[];
}

export interface AppliedReferencePlan {
  changed: number;
  rollback: () => Promise<void>;
}

interface Candidate {
  start: number;
  end: number;
  value: string;
  /** True when the literal participates in string concatenation. */
  dynamic?: boolean;
  /** Trimmed source line used for diagnostics. */
  expression?: string;
}

const IMAGE_VALUE = /\.(?:jpe?g|png|webp|avif)(?:[?#][^\s"')>]+)?$/i;
const DYNAMIC_VALUE = /[${}]|\b(?:join|resolve|concat)\s*\(/;
const DYNAMIC_EXPRESSION =
  /\b(?:path\.)?(?:join|resolve|concat)\s*\([^;\n]*(?:jpe?g|png|webp|avif)/i;

function stripSuffix(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? value;
}

function sourceExtension(sourcePath: string): string | undefined {
  const extension = sourcePath
    .slice(sourcePath.lastIndexOf(".") + 1)
    .toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "jpeg";
  if (extension === "png" || extension === "webp" || extension === "avif")
    return extension;
  return undefined;
}

function lineAround(content: string, index: number): string {
  const start = content.lastIndexOf("\n", index) + 1;
  const end = content.indexOf("\n", index);
  const line = content.slice(start, end === -1 ? content.length : end).trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function isConcatenated(content: string, start: number, end: number): boolean {
  const before = content
    .slice(Math.max(0, start - 5), start)
    .replace(/['"`]$/, "");
  const after = content.slice(end, end + 5).replace(/^['"`]/, "");
  return /[+]\s*$/.test(before) || /^\s*\+/.test(after);
}

function candidatesFor(content: string, extension: string): Candidate[] {
  const candidates: Candidate[] = [];
  const push = (match: RegExpExecArray, valueIndex: number) => {
    const value = match[valueIndex];
    if (!value || !IMAGE_VALUE.test(value)) return;
    const start = match.index + match[0].indexOf(value);
    const end = start + value.length;
    const dynamic = isConcatenated(content, start, end);
    candidates.push({
      start,
      end,
      value,
      dynamic: dynamic || undefined,
      expression: dynamic ? lineAround(content, start) : undefined,
    });
  };

  if (
    extension === ".css" ||
    extension === ".scss" ||
    extension === ".sass" ||
    extension === ".less"
  ) {
    const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    for (
      let match = pattern.exec(content);
      match;
      match = pattern.exec(content)
    )
      push(match, 2);
  } else if (extension === ".html" || extension === ".htm") {
    const attribute =
      /\b(src|srcset|poster|href|content)\s*=\s*(["'])(.*?)\2/gi;
    for (
      let match = attribute.exec(content);
      match;
      match = attribute.exec(content)
    ) {
      const attributeName = match[1]?.toLowerCase();
      const value = match[3];
      if (!attributeName || !value) continue;

      if (attributeName !== "srcset") {
        if (IMAGE_VALUE.test(value)) {
          const start = match.index + match[0].indexOf(value);
          candidates.push({ start, end: start + value.length, value });
        }
        continue;
      }

      let offset = 0;
      for (const part of value.split(",")) {
        const leading = part.search(/\S/);
        const token =
          part
            .trim()
            .match(
              /^(.*?\.(?:jpe?g|png|webp|avif)(?:[?#][^\s"')>]+)?)(?:\s+.*)?$/i,
            )?.[1] ?? "";
        if (!token || !IMAGE_VALUE.test(token)) {
          offset += part.length + 1;
          continue;
        }
        const start =
          match.index + match[0].indexOf(value) + offset + Math.max(leading, 0);
        candidates.push({ start, end: start + token.length, value: token });
        offset += part.length + 1;
      }
    }
  } else {
    const srcset = /\bsrcSet\s*=\s*(?:\{\s*)?(['"])(.*?)\1(?:\s*\})?/gi;
    for (
      let match = srcset.exec(content);
      match;
      match = srcset.exec(content)
    ) {
      const value = match[2] ?? "";
      let offset = 0;
      for (const part of value.split(",")) {
        const leading = part.search(/\S/);
        const token =
          part
            .trim()
            .match(
              /^(.*?\.(?:jpe?g|png|webp|avif)(?:[?#][^\s"')>]+)?)(?:\s+.*)?$/i,
            )?.[1] ?? "";
        if (token && IMAGE_VALUE.test(token)) {
          const valueStart = match.index + match[0].indexOf(value);
          const start = valueStart + offset + Math.max(leading, 0);
          candidates.push({ start, end: start + token.length, value: token });
        }
        offset += part.length + 1;
      }
    }

    const patterns = [
      /\bfrom\s*(['"])([^'"]+)\1/gi,
      /\bimport\s*(['"])([^'"]+)\1/gi,
      /\bimport\s*\(\s*(['"])([^'"]+)\1/gi,
      /\brequire\s*\(\s*(['"])([^'"]+)\1/gi,
      /\bnew\s+URL\s*\(\s*(['"])([^'"]+)\1/gi,
      /\b(?:src|srcSet|poster|href)\s*=\s*(['"])([^'"]+)\1/gi,
      /\b(?:src|srcSet|poster|href)\s*=\s*\{\s*(['"])([^'"]+)\1\s*\}/gi,
      /\b(?:url|image|asset)\s*[:=]\s*(['"`])([^'"`]+)\1/gi,
      /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(['"`])([^'"`]+)\1/gi,
      /\+[ \t]*(['"])([^'"\n]+)\1/gi,
      /(['"])([^'"\n]+)\1[ \t]*\+/gi,
    ];
    for (const pattern of patterns) {
      for (
        let match = pattern.exec(content);
        match;
        match = pattern.exec(content)
      ) {
        push(match, 2);
      }
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.start}:${candidate.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveReference(
  value: string,
  referenceFile: string,
  cwd: string,
  transformations: Map<string, AssetTransformation>,
): {
  transformation?: AssetTransformation;
  reason?: UnresolvedReference["reason"];
} {
  if (value.startsWith("data:") || value.startsWith("#"))
    return { reason: "unsupported" };
  if (DYNAMIC_VALUE.test(value)) return { reason: "dynamic" };

  const rawPath = stripSuffix(value).replace(/^\//, "");
  const direct = value.startsWith("/")
    ? resolve(cwd, rawPath)
    : resolve(dirname(referenceFile), rawPath);
  const candidates = [direct, resolve(cwd, rawPath)];
  const exact = candidates
    .map((candidate) => transformations.get(candidate.toLowerCase()))
    .find(Boolean);
  if (exact) return { transformation: exact };

  const suffix = toPortablePath(rawPath).toLowerCase();
  const suffixMatches = [...transformations.values()].filter(
    (item) =>
      toPortablePath(item.sourcePath).toLowerCase().endsWith(`/${suffix}`) ||
      toPortablePath(item.sourcePath).toLowerCase() === suffix,
  );
  if (suffixMatches.length === 1) return { transformation: suffixMatches[0] };
  if (suffixMatches.length > 1) return { reason: "ambiguous" };
  return { reason: "not-found" };
}

function couldReferToTransformation(
  value: string,
  transformations: AssetTransformation[],
): boolean {
  if (DYNAMIC_VALUE.test(value)) {
    const match = /\.(jpe?g|png|webp|avif)(?![a-z0-9])/i.exec(value);
    if (!match) return false;
    const extension = match[1]?.toLowerCase();
    const normalized =
      extension === "jpg" || extension === "jpeg" ? "jpeg" : extension;
    return transformations.some(
      (item) => sourceExtension(item.sourcePath) === normalized,
    );
  }

  const suffix = toPortablePath(
    stripSuffix(value).replace(/^\//, ""),
  ).toLowerCase();
  return transformations.some((item) => {
    const source = toPortablePath(item.sourcePath).toLowerCase();
    return (
      source.endsWith(`/${suffix}`) || basename(source) === basename(suffix)
    );
  });
}

function replacementFor(
  value: string,
  referenceFile: string,
  outputPath: string,
  cwd: string,
  inPlace: boolean,
): string {
  const query = value.slice(stripSuffix(value).length);
  if (inPlace) {
    const path = stripSuffix(value);
    const extension = extname(outputPath);
    return `${path.slice(0, -extname(path).length)}${extension}${query}`;
  }

  const source = value.startsWith("/")
    ? `/${toPortablePath(relative(cwd, outputPath))}`
    : toPortablePath(relative(dirname(referenceFile), outputPath));
  const withPrefix =
    value.startsWith("./") && !source.startsWith(".") ? `./${source}` : source;
  return `${withPrefix}${query}`;
}

export async function buildReferencePlan(
  transformations: AssetTransformation[],
  options: ResolvedRunOptions,
): Promise<ReferencePlan> {
  const map = new Map(
    transformations.map((item) => [pathIdentity(item.sourcePath), item]),
  );
  const roots = options.references.roots?.length
    ? options.references.roots.map((root) => resolve(options.cwd, root))
    : [options.cwd];
  const include = options.references.include?.length
    ? options.references.include
    : DEFAULT_REFERENCE_INCLUDE;
  const exclude = options.references.exclude?.length
    ? options.references.exclude
    : DEFAULT_REFERENCE_EXCLUDE;
  const files = (
    await Promise.all(
      roots.map((root) =>
        fg.glob(include, {
          cwd: root,
          absolute: true,
          onlyFiles: true,
          ignore: exclude,
          unique: true,
          followSymbolicLinks: false,
        }),
      ),
    )
  ).flat();
  const uniqueFiles = [...new Set(files.map((file) => resolve(file)))].filter(
    (file) => {
      const outputRelative = relative(options.output, file);
      const insideOutput =
        outputRelative === "" ||
        (!isAbsolute(outputRelative) &&
          outputRelative !== ".." &&
          !outputRelative.startsWith(`..${sep}`));
      return !insideOutput;
    },
  );
  const changes: ReferenceChange[] = [];
  const unresolved: UnresolvedReference[] = [];

  for (const [fileIndex, file] of uniqueFiles.entries()) {
    const absoluteFile = resolve(file);
    const content = await readText(absoluteFile);
    const dynamicMatch = content.match(DYNAMIC_EXPRESSION);
    if (dynamicMatch && transformations.length > 0) {
      unresolved.push({
        filePath: absoluteFile,
        value: dynamicMatch[0],
        reason: "dynamic",
      });
    }
    for (const candidate of candidatesFor(
      content,
      absoluteFile.slice(absoluteFile.lastIndexOf(".")).toLowerCase(),
    )) {
      if (candidate.dynamic) {
        if (couldReferToTransformation(candidate.value, transformations)) {
          unresolved.push({
            filePath: absoluteFile,
            value: candidate.expression ?? candidate.value,
            reason: "dynamic",
          });
        }
        continue;
      }
      const resolved = resolveReference(
        candidate.value,
        absoluteFile,
        options.cwd,
        map,
      );
      if (!resolved.transformation) {
        if (
          resolved.reason &&
          couldReferToTransformation(candidate.value, transformations)
        ) {
          unresolved.push({
            filePath: absoluteFile,
            value: candidate.value,
            reason: resolved.reason,
          });
        }
        continue;
      }
      const after = replacementFor(
        candidate.value,
        absoluteFile,
        resolved.transformation.outputPath,
        options.cwd,
        options.inPlace,
      );
      if (after === candidate.value) continue;
      changes.push({
        filePath: absoluteFile,
        start: candidate.start,
        end: candidate.end,
        before: candidate.value,
        after,
      });
    }
    options.onProgress?.({
      phase: "references",
      completed: fileIndex + 1,
      total: uniqueFiles.length,
      file: absoluteFile,
    });
  }

  const seenUnresolved = new Set<string>();
  const dedupedUnresolved = unresolved.filter((reference) => {
    const key = `${reference.filePath}\u0000${reference.value}\u0000${reference.reason}`;
    if (seenUnresolved.has(key)) return false;
    seenUnresolved.add(key);
    return true;
  });

  return {
    filesScanned: uniqueFiles.length,
    changes,
    unresolved: dedupedUnresolved,
  };
}

function applyChanges(content: string, changes: ReferenceChange[]): string {
  const ordered = [...changes].sort((left, right) => right.start - left.start);
  for (const change of ordered) {
    if (content.slice(change.start, change.end) !== change.before) {
      throw new ImageSlimError(
        "REFERENCE_UPDATE_FAILED",
        `Reference file changed while updating: ${change.filePath}`,
      );
    }
  }
  return ordered.reduce(
    (result, change) =>
      result.slice(0, change.start) + change.after + result.slice(change.end),
    content,
  );
}

export async function applyReferencePlan(
  plan: ReferencePlan,
  dryRun: boolean,
  boundary?: string,
): Promise<AppliedReferencePlan> {
  if (dryRun) {
    return { changed: plan.changes.length, rollback: async () => undefined };
  }
  const grouped = new Map<string, ReferenceChange[]>();
  for (const change of plan.changes) {
    const current = grouped.get(change.filePath) ?? [];
    current.push(change);
    grouped.set(change.filePath, current);
  }

  const originals = new Map<string, string>();
  const rollback = async (): Promise<void> => {
    for (const [filePath, original] of originals) {
      await writeTextAtomic(filePath, original, { boundary });
    }
  };

  try {
    for (const [filePath, changes] of grouped) {
      const original = await readFile(filePath, "utf8");
      originals.set(filePath, original);
      await writeTextAtomic(filePath, applyChanges(original, changes), {
        boundary,
      });
    }
  } catch (error) {
    await rollback();
    throw error;
  }

  return { changed: plan.changes.length, rollback };
}
