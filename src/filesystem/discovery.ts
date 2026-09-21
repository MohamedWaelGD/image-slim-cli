import { lstat, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import fg from "fast-glob";
import micromatch from "micromatch";
import { ImageSlimError } from "../errors/image-slim-error";
import {
  isGlobPattern,
  makeRelativePath,
  normalizeExtensions,
  pathIdentity,
  staticGlobBase,
} from "./paths";
import type { ImageSlimConfig } from "../types/public";

export interface DiscoveredFile {
  absolutePath: string;
  relativePath: string;
  root: string;
}

async function existingPath(
  path: string,
): Promise<"file" | "directory" | undefined> {
  try {
    const info = await stat(path);
    return info.isDirectory()
      ? "directory"
      : info.isFile()
        ? "file"
        : undefined;
  } catch {
    return undefined;
  }
}

async function isSymbolicLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

function extensionPatterns(extensions: string[]): string[] {
  return extensions.map((extension) => extension.replace(/^\./, ""));
}

export async function discoverFiles(
  inputs: string[],
  options: Pick<
    ImageSlimConfig,
    "exclude" | "include" | "extensions" | "followSymlinks"
  > & { output?: string },
  cwd = process.cwd(),
): Promise<DiscoveredFile[]> {
  if (inputs.length === 0) {
    throw new ImageSlimError(
      "INVALID_INPUT",
      "No input files or directories were provided.",
    );
  }

  const extensions = normalizeExtensions(options.extensions);
  const ignore = options.exclude ?? [];
  const followSymlinks = options.followSymlinks ?? false;
  const discovered: DiscoveredFile[] = [];

  for (const input of inputs) {
    const resolvedInput = resolve(cwd, input);
    const kind = isGlobPattern(input)
      ? undefined
      : await existingPath(resolvedInput);

    if (!isGlobPattern(input) && !kind) {
      throw new ImageSlimError(
        "INPUT_NOT_FOUND",
        `Input was not found: ${input}`,
      );
    }

    if (kind === "file") {
      if (
        extensions.includes(
          resolvedInput.slice(resolvedInput.lastIndexOf(".")).toLowerCase(),
        )
      ) {
        if (!followSymlinks && (await isSymbolicLink(resolvedInput))) {
          throw new ImageSlimError(
            "UNSAFE_INPUT",
            `Refusing to process a symbolic-link input: ${input}. Pass --follow-symlinks to opt in.`,
          );
        }
        discovered.push({
          absolutePath: resolvedInput,
          relativePath: makeRelativePath(
            resolvedInput,
            resolve(resolvedInput, ".."),
          ),
          root: resolve(resolvedInput, ".."),
        });
      }
      continue;
    }

    const root =
      kind === "directory" ? resolvedInput : staticGlobBase(input, cwd);
    const extensionGlob =
      extensions.length === 1
        ? `**/*.${extensionPatterns(extensions)[0]}`
        : `**/*.{${extensionPatterns(extensions).join(",")}}`;
    const pattern = kind === "directory" ? extensionGlob : input;
    const outputRelative = options.output
      ? relative(root, resolve(options.output))
      : "";
    const outputIgnore =
      outputRelative &&
      outputRelative !== "." &&
      outputRelative !== ".." &&
      !outputRelative.startsWith(`..${sep}`) &&
      !isAbsolute(outputRelative)
        ? `${outputRelative.replaceAll("\\", "/")}/**`
        : undefined;
    const matches = await fg.glob(pattern, {
      cwd: kind === "directory" ? root : cwd,
      absolute: true,
      onlyFiles: true,
      unique: true,
      followSymbolicLinks: followSymlinks,
      ignore: outputIgnore ? [...ignore, outputIgnore] : ignore,
    });

    for (const match of matches) {
      const absolutePath = resolve(match);
      const extension = absolutePath
        .slice(absolutePath.lastIndexOf("."))
        .toLowerCase();
      if (!extensions.includes(extension)) continue;
      if (!followSymlinks && (await isSymbolicLink(absolutePath))) continue;
      discovered.push({
        absolutePath,
        relativePath: makeRelativePath(absolutePath, root),
        root,
      });
    }
  }

  const include = options.include ?? [];
  const included =
    include.length === 0
      ? discovered
      : discovered.filter((file) =>
          micromatch.isMatch(file.relativePath.replaceAll("\\", "/"), include),
        );
  const filtered =
    ignore.length === 0
      ? included
      : included.filter(
          (file) =>
            !micromatch.isMatch(
              file.relativePath.replaceAll("\\", "/"),
              ignore,
            ),
        );

  const unique = new Map<string, DiscoveredFile>();
  for (const file of filtered)
    unique.set(pathIdentity(file.absolutePath), file);
  return [...unique.values()].sort((left, right) =>
    left.absolutePath.localeCompare(right.absolutePath),
  );
}
