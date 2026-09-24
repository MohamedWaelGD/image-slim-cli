# @mohamedwaelgd/image-slim-cli

Fast, safe image optimization for Node.js projects.

Image Slim uses Sharp to resize and convert static image assets while protecting
source files by default. It can also update static HTML, CSS, JavaScript, and
TypeScript references when an image path maps unambiguously to an optimized
file.

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Operating Modes](#operating-modes)
- [Safety](#safety)
- [CLI Reference](#cli-reference)
  - [Input Discovery](#input-discovery)
  - [Output and Replacement](#output-and-replacement)
  - [Encoding and Resizing](#encoding-and-resizing)
  - [Metadata and Safety](#metadata-and-safety)
  - [Reference Updates](#reference-updates)
  - [Reporting and Configuration](#reporting-and-configuration)
- [Framework Examples](#framework-examples)
- [Configuration](#configuration)
- [Node API](#node-api)
- [Exit Codes](#exit-codes)
- [Benchmarks](#benchmarks)
- [Development](#development)
- [License](#license)

## Requirements

- Node.js 20 or newer
- Supported image formats: JPEG, PNG, WebP, and AVIF

[Back to contents](#contents)

## Installation

```bash
npm install --save-dev @mohamedwaelgd/image-slim-cli
```

Run it without installing globally:

```bash
npx @mohamedwaelgd/image-slim-cli ./public
```

The executable is named `image-slim`.

[Back to contents](#contents)

## Quick Start

The default behavior recursively discovers images and writes optimized copies
to `./optimized`. Source files are not overwritten.

```bash
image-slim ./public
```

Convert assets to WebP in a separate directory:

```bash
image-slim ./src/assets --out ./optimized --format webp
```

[Back to contents](#contents)

## Operating Modes

Image Slim has three modes. They differ in how much of your repository they
are allowed to change.

### 1. Safe output mode

```bash
image-slim ./public
```

```text
public/                    optimized/
  hero.jpg        ->         hero.jpg
  logo.png         ->        logo.png
```

Originals are untouched. Use `--out <dir>` to choose a different destination.

### 2. In-place optimization

```bash
image-slim ./public --in-place
```

Accepted output is written beside each source image. A same-format image can be
replaced only when it is smaller by at least `--min-savings`. A converted image
(for example `hero.jpg` to `hero.webp`) is written next to the original, which
is preserved unless you also pass `--remove-originals`.

### 3. Migration mode (destructive)

```bash
image-slim ./public \
  --in-place \
  --format webp \
  --update-references \
  --references ./src \
  --remove-originals
```

This is the powerful mode. It converts images, rewrites static references, and
then removes the originals. It is transactional: if conversion, reference
updating, or removal fails for any reason, Image Slim restores the originals,
rolls back reference changes, and deletes generated output.

Read [Safety](#safety) before using it.

[Back to contents](#contents)

## Safety

> **Before using `--in-place` or `--remove-originals`, commit your work or back
> up your repository.** Run with `--dry-run` first to see exactly what would
> happen. Image Slim updates static references conservatively and **does not**
> resolve dynamically constructed asset paths such as
> `` `/assets/${name}.jpg` `` or `path.join("assets", name + ".jpg")`. When such
> a reference is relevant to a destructive operation, the operation is refused
> rather than guessed.
>
> Animated WebP inputs are skipped with an explanation so their frames are
> preserved.

Additional guarantees:

- Writes are atomic. Temporary and backup files are never left behind after a
  successful run.
- A failed replacement restores the original content. If restoration itself is
  impossible, a recoverable backup is preserved and its path is reported.
- Symbolic links are not followed during discovery by default, and writes never
  pass through a symbolic link below the destination root. A symbolic-link
  output directory is rejected.
- Destructive mode cannot be combined with `--overwrite`, because replaced
  files could not be rolled back.
- Concurrency is capped at 64 to bound memory use.

[Back to contents](#contents)

## CLI Reference

The command accepts one or more input paths, directories, or glob patterns.

[Back to contents](#contents)

### Input Discovery

| Input               | Value                        | Default                                 | Description                                       |
| ------------------- | ---------------------------- | --------------------------------------- | ------------------------------------------------- |
| `[inputs...]`       | Files, directories, or globs | Required unless configured              | Assets to process. Multiple inputs are supported. |
| `--extensions`      | Comma-separated extensions   | `.jpg,.jpeg,.png,.webp,.avif`           | Restricts discovered input extensions.            |
| `--include`         | Glob pattern; repeatable     | `[]`                                    | Includes only matching input paths.               |
| `--exclude`         | Glob pattern; repeatable     | Common generated/dependency directories | Excludes matching input paths.                    |
| `--follow-symlinks` | Boolean flag                 | `false`                                 | Traverses symbolic-link directories and files.    |

When `--follow-symlinks` is disabled, symbolic-link images are skipped and an
explicit symbolic-link input file is refused.

[Back to contents](#contents)

### Output and Replacement

| Input                | Value        | Default       | Description                                                                                            |
| -------------------- | ------------ | ------------- | ------------------------------------------------------------------------------------------------------ |
| `--out`              | Directory    | `./optimized` | Writes results to a separate output directory.                                                         |
| `--overwrite`        | Boolean flag | `false`       | Allows replacing existing files in the output directory.                                               |
| `--in-place`         | Boolean flag | `false`       | Writes accepted results beside source files.                                                           |
| `--remove-originals` | Boolean flag | `false`       | Removes source files after reference updates succeed. Requires `--in-place` and `--update-references`. |

`--out` and `--in-place` cannot be used together. In-place conversion does not
overwrite an existing destination by default. `--remove-originals` cannot be
combined with `--overwrite`.

[Back to contents](#contents)

### Encoding and Resizing

| Input              | Value                                | Default    | Description                                                                 |
| ------------------ | ------------------------------------ | ---------- | --------------------------------------------------------------------------- |
| `--format`         | `original`, `jpeg`, `png`, `webp`, or `avif` | `original` | Selects the output format.                                                  |
| `--quality`        | `1`-`100`                            | `82`       | Sets lossy encoding quality.                                                |
| `--min-quality`    | `1`-`100`                            | `40`       | Lowest quality used when searching for a target size.                       |
| `--target-size`    | Size such as `500kb` or `1mb`        | Unset      | Searches for an encoding that stays under the target when possible.         |
| `--max-width`      | Pixels                               | Unset      | Limits output width. Smaller images are not enlarged by default.            |
| `--max-height`     | Pixels                               | Unset      | Limits output height.                                                       |
| `--allow-upscale`  | Boolean flag                         | `false`    | Allows images to be enlarged to meet dimensions.                            |
| `--background`     | Color                                | `#ffffff`  | Background used when transparent images are converted to JPEG.              |
| `--min-savings`    | Percentage                           | `5`        | Requires this minimum reduction before replacing or writing an output.      |
| `--skip-if-larger` | Boolean flag                         | `true`     | Skips output when it is not smaller than the source.                        |
| `--allow-larger`   | Boolean flag                         | `false`    | Accepts an output even when it is larger. Disables skip-if-larger behavior. |
| `--concurrency`    | Positive number, at most `64`        | `2`        | Maximum number of active image jobs.                                        |

[Back to contents](#contents)

### Metadata and Safety

| Input                   | Value        | Default  | Description                                                                                 |
| ----------------------- | ------------ | -------- | ------------------------------------------------------------------------------------------- |
| `--strip-metadata`      | Boolean flag | Enabled  | Removes image metadata.                                                                     |
| `--keep-metadata`       | Boolean flag | Disabled | Preserves image metadata.                                                                   |
| `--dry-run`             | Boolean flag | `false`  | Encodes and reports without writing files.                                                  |
| `--check`               | Boolean flag | `false`  | Checks assets without writing files; implies dry-run behavior.                              |
| `--fail-on-unoptimized` | Boolean flag | `false`  | Returns exit code `1` when a check finds assets that need optimization. Requires `--check`. |
| `--fail-on-target-size` | Boolean flag | `false`  | Returns exit code `1` if any encoded output exceeds `--target-size`.                   |

`--keep-metadata` and `--strip-metadata` cannot be combined. Likewise,
`--allow-larger` and `--skip-if-larger` cannot be combined explicitly.

[Back to contents](#contents)

### Reference Updates

| Input                 | Value                    | Default                             | Description                                                                     |
| --------------------- | ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------- |
| `--update-references` | Boolean flag             | `false`                             | Updates static image references in HTML, CSS, JS, TS, Vue, Astro, and Svelte files. |
| `--references`        | Directory; repeatable    | None                                | Roots to scan for source references.                                            |
| `--reference-include` | Glob pattern; repeatable | Supported source files              | Includes matching reference files.                                              |
| `--reference-exclude` | Glob pattern; repeatable | Generated, minified, and test files | Excludes matching reference files.                                              |

Reference updates scan HTML, CSS, JavaScript, TypeScript, Vue, Astro, and Svelte
files. They are conservative: a reference is rewritten only when it maps to
exactly one discovered image. Dynamic path construction, missing paths, and
ambiguous matches are reported but are never rewritten.

Use `--remove-originals` only when the reference scan reports no relevant
unresolved references. The CLI removes originals only after the output and
reference update transactions have succeeded.

[Back to contents](#contents)

### Reporting and Configuration

| Input        | Value                        | Default         | Description                         |
| ------------ | ---------------------------- | --------------- | ----------------------------------- |
| `--report`   | `text` or `json`             | `text`          | Selects the report format.          |
| `--progress` | `auto`, `always`, or `never` | `auto`          | Controls terminal progress output.  |
| `--verbose`  | Boolean flag                 | `false`         | Prints every processed file.        |
| `--quiet`    | Boolean flag                 | `false`         | Suppresses text output.             |
| `--config`   | File path                    | Auto-discovered | Loads a project configuration file. |
| `--version`  | Boolean flag                 | N/A             | Prints the package version.         |
| `--help`     | Boolean flag                 | N/A             | Prints CLI usage and options.       |

Progress is written to stderr, so JSON reports remain clean on stdout.

A dry run reports everything it would do without touching the filesystem:

```text
Image Slim (dry run)

Found               128

Optimize             94
Convert              73
Copy                 13
Skip                 21
Failed                0

References
Scanned             214 files
Would update         67
Unresolved            2

Originals
Would remove         73

Estimated
Original          142.8 MB
Optimized          48.2 MB
Saved              94.6 MB (66.2%)

Completed in        3.40s

No files were modified.
```

`--verbose` explains each decision:

```text
+ assets/hero.jpg
  2.8 MB -> 624.0 KB
  JPEG -> WEBP
  77.7% smaller
- assets/logo.png
  skipped: optimized output was larger (12.0 KB)
```

Verbose mode also lists unresolved references with their reason:

```text
Unresolved            2
  src/app.ts: path.join("assets", name + ".jpg") (dynamic)
```

[Back to contents](#contents)

## Framework Examples

All examples assume the CLI is installed as a dev dependency.

### Angular

```bash
image-slim ./src/assets/images \
  --in-place \
  --format webp \
  --update-references \
  --references ./src
```

### React

```bash
image-slim ./src/assets \
  --in-place \
  --format webp \
  --update-references \
  --references ./src
```

### Next.js

```bash
image-slim ./public \
  --format webp \
  --out ./public/optimized
```

Next.js serves assets from `public`, so prefer safe output mode and point
components at the optimized tree, or run in-place with `--references ./app
./components ./pages`.

### Vue

```bash
image-slim ./src/assets \
  --in-place \
  --format webp \
  --update-references \
  --references ./src
```

### Astro

```bash
image-slim ./src/assets \
  --in-place \
  --format webp \
  --update-references \
  --references ./src
```

### Vite

```bash
image-slim ./src/assets \
  --in-place \
  --format webp \
  --update-references \
  --references ./src
```

### Plain HTML and CSS

```bash
image-slim ./assets \
  --in-place \
  --format webp \
  --update-references \
  --references ./assets
```

[Back to contents](#contents)

## Configuration

Create `image-slim.config.ts`, `image-slim.config.mts`,
`image-slim.config.js`, `image-slim.config.mjs`, or
`image-slim.config.cjs` in the project root:

```ts
import { defineConfig } from "@mohamedwaelgd/image-slim-cli";

export default defineConfig({
  input: ["src/assets/**/*", "public/**/*"],
  output: "./optimized",
  format: "webp",
  quality: 82,
  maxWidth: 1920,
  concurrency: 2,
  references: {
    update: true,
    roots: ["src"],
    exclude: ["**/*.spec.ts", "**/*.test.ts"],
  },
});
```

CLI options override values loaded from the configuration file. Pass
`--config <path>` to use a non-standard configuration path.

> **Configuration files execute as Node.js modules.**
> `image-slim.config.ts`, `image-slim.config.js`, and the other supported
> configuration files are loaded and executed through `jiti`. They therefore
> have the same system access as any other Node.js configuration file. Only run
> Image Slim with configuration files from repositories you trust.

[Back to contents](#contents)

## Node API

```ts
import {
  checkImages,
  optimize,
  optimizeDirectory,
  optimizeFile,
} from "@mohamedwaelgd/image-slim-cli";

await optimizeDirectory("./public", {
  output: "./optimized",
  format: "webp",
  quality: 82,
});

await optimizeFile("./public/hero.jpg", { format: "webp" });
await optimize(["./public", "./src/assets"], { format: "webp" });

const check = await checkImages("./public");
console.log(check.hasUnoptimizedFiles);
```

Use `defineConfig` for typed configuration files. API callers can receive
structured progress events through `onProgress`, and optimization calls return
an `OptimizationReport` containing per-file results, byte totals, savings,
reference changes, unresolved references, and duration.

[Back to contents](#contents)

## Exit Codes

|  Code | Meaning                                                              |
| ----: | -------------------------------------------------------------------- |
|   `0` | Successful optimization, check, help, or version output.             |
|   `1` | `--check --fail-on-unoptimized` found assets that need optimization. |
|   `1` | `--fail-on-target-size` found an output above the requested target.   |
|   `2` | Invalid options or command usage.                                    |
|   `3` | Processing, configuration, or filesystem failure.                    |
| `130` | Interrupted with Ctrl+C or another abort signal.                     |

[Back to contents](#contents)

## Benchmarks

Reproducible performance and memory benchmarks live in `benchmarks/`.

```bash
npm run bench
npm run bench -- --workload normal --concurrency 1,2,4
```

Each run reports execution time, images per second, peak RSS, input and output
bytes, total savings, and per-file outcome counts. See
[`benchmarks/README.md`](benchmarks/README.md) for workload definitions and
guidance on interpreting results.

[Back to contents](#contents)

## Development

Clone the repository, install dependencies, then run:

```bash
npm install
npm run validate:package
```

Useful repository commands:

| Command                    | Description                                                                   |
| -------------------------- | ----------------------------------------------------------------------------- |
| `npm run build`            | Builds the ESM, CommonJS, and declaration outputs.                            |
| `npm run typecheck`        | Runs TypeScript without emitting files.                                       |
| `npm run lint`             | Runs ESLint.                                                                  |
| `npm run format`           | Formats repository files with Prettier.                                       |
| `npm run format:check`     | Checks Prettier formatting.                                                   |
| `npm test`                 | Runs the test suite once.                                                     |
| `npm run test:watch`       | Runs Vitest in watch mode.                                                    |
| `npm run test:package`     | Packs the package and exercises it from an isolated install.                  |
| `npm run bench`            | Runs the performance and memory benchmarks.                                   |
| `npm run audit:prod`       | Audits production dependencies.                                               |
| `npm run validate:package` | Runs typecheck, lint, formatting, tests, build, publint, and pack validation. |

CI runs the full validation suite on Node 20, 22, and 24 on Ubuntu, plus Node 20
on Windows and macOS.

[Back to contents](#contents)

## License

MIT

[Back to contents](#contents)
