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
- [Common Workflows](#common-workflows)
- [CLI Reference](#cli-reference)
  - [Input Discovery](#input-discovery)
  - [Output and Replacement](#output-and-replacement)
  - [Encoding and Resizing](#encoding-and-resizing)
  - [Metadata and Safety](#metadata-and-safety)
  - [Reference Updates](#reference-updates)
  - [Reporting and Configuration](#reporting-and-configuration)
- [Configuration](#configuration)
- [Node API](#node-api)
- [Exit Codes](#exit-codes)
- [Development](#development)
- [License](#license)

## Requirements

- Node.js 20 or newer
- Supported image formats: JPEG, PNG, and WebP

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

## Common Workflows

| Scenario                  | Command                                                                                                      | Result                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Safe default optimization | `image-slim ./public`                                                                                        | Writes optimized copies to `./optimized`.                              |
| Separate WebP output      | `image-slim ./src/assets --out ./optimized --format webp`                                                    | Converts images without changing the source tree.                      |
| Preview an encode         | `image-slim ./public --format webp --dry-run --verbose`                                                      | Encodes and reports results without writing files.                     |
| In-place optimization     | `image-slim ./public/images --in-place`                                                                      | Writes accepted output beside each source image.                       |
| Safe WebP migration       | `image-slim ./src/assets --in-place --format webp --update-references --references ./src --remove-originals` | Updates resolvable references, then removes originals transactionally. |
| CI cleanliness check      | `image-slim ./public --check --fail-on-unoptimized`                                                          | Exits with code `1` when assets still need optimization.               |
| JSON report               | `image-slim ./public --check --report json --progress never`                                                 | Writes machine-readable output to stdout.                              |
| Resize large images       | `image-slim ./uploads --out ./optimized --max-width 1920 --max-height 1080`                                  | Limits dimensions without enlarging smaller images.                    |
| Target a file size        | `image-slim ./public --format webp --target-size 500kb`                                                      | Searches for quality settings that meet the target when possible.      |
| Optimize selected files   | `image-slim ./src/assets --include "**/hero-*" --exclude "**/*.test.*"`                                      | Processes only paths matching the filters.                             |

[Back to contents](#contents)

## CLI Reference

The command accepts one or more input paths, directories, or glob patterns.

[Back to contents](#contents)

### Input Discovery

| Input               | Value                        | Default                                 | Description                                       |
| ------------------- | ---------------------------- | --------------------------------------- | ------------------------------------------------- |
| `[inputs...]`       | Files, directories, or globs | Required unless configured              | Assets to process. Multiple inputs are supported. |
| `--extensions`      | Comma-separated extensions   | `.jpg,.jpeg,.png,.webp`                 | Restricts discovered input extensions.            |
| `--include`         | Glob pattern; repeatable     | `[]`                                    | Includes only matching input paths.               |
| `--exclude`         | Glob pattern; repeatable     | Common generated/dependency directories | Excludes matching input paths.                    |
| `--follow-symlinks` | Boolean flag                 | `false`                                 | Traverses symbolic-link directories.              |

[Back to contents](#contents)

### Output and Replacement

| Input                | Value        | Default       | Description                                                                                            |
| -------------------- | ------------ | ------------- | ------------------------------------------------------------------------------------------------------ |
| `--out`              | Directory    | `./optimized` | Writes results to a separate output directory.                                                         |
| `--overwrite`        | Boolean flag | `false`       | Allows replacing existing files in the output directory.                                               |
| `--in-place`         | Boolean flag | `false`       | Writes accepted results beside source files.                                                           |
| `--remove-originals` | Boolean flag | `false`       | Removes source files after reference updates succeed. Requires `--in-place` and `--update-references`. |

`--out` and `--in-place` cannot be used together. In-place conversion does not
overwrite an existing destination by default.

[Back to contents](#contents)

### Encoding and Resizing

| Input              | Value                                | Default    | Description                                                                 |
| ------------------ | ------------------------------------ | ---------- | --------------------------------------------------------------------------- |
| `--format`         | `original`, `jpeg`, `png`, or `webp` | `original` | Selects the output format.                                                  |
| `--quality`        | `1`-`100`                            | `82`       | Sets lossy encoding quality.                                                |
| `--target-size`    | Size such as `500kb` or `1mb`        | Unset      | Searches for an encoding that stays under the target when possible.         |
| `--max-width`      | Pixels                               | Unset      | Limits output width. Smaller images are not enlarged by default.            |
| `--max-height`     | Pixels                               | Unset      | Limits output height.                                                       |
| `--allow-upscale`  | Boolean flag                         | `false`    | Allows images to be enlarged to meet dimensions.                            |
| `--background`     | Color                                | `#ffffff`  | Background used when transparent images are converted to JPEG.              |
| `--min-savings`    | Percentage                           | `5`        | Requires this minimum reduction before replacing or writing an output.      |
| `--skip-if-larger` | Boolean flag                         | `true`     | Skips output when it is not smaller than the source.                        |
| `--allow-larger`   | Boolean flag                         | `false`    | Accepts an output even when it is larger. Disables skip-if-larger behavior. |
| `--concurrency`    | Positive number                      | `2`        | Maximum number of active image jobs.                                        |

[Back to contents](#contents)

### Metadata and Safety

| Input                   | Value        | Default  | Description                                                                                 |
| ----------------------- | ------------ | -------- | ------------------------------------------------------------------------------------------- |
| `--strip-metadata`      | Boolean flag | Enabled  | Removes image metadata.                                                                     |
| `--keep-metadata`       | Boolean flag | Disabled | Preserves image metadata.                                                                   |
| `--dry-run`             | Boolean flag | `false`  | Encodes and reports without writing files.                                                  |
| `--check`               | Boolean flag | `false`  | Checks assets without writing files; implies dry-run behavior.                              |
| `--fail-on-unoptimized` | Boolean flag | `false`  | Returns exit code `1` when a check finds assets that need optimization. Requires `--check`. |

`--keep-metadata` and `--strip-metadata` cannot be combined. Likewise,
`--allow-larger` and `--skip-if-larger` cannot be combined explicitly.

[Back to contents](#contents)

### Reference Updates

| Input                 | Value                    | Default                             | Description                                                                     |
| --------------------- | ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------- |
| `--update-references` | Boolean flag             | `false`                             | Updates static image references in HTML, CSS, SCSS, Less, JS, JSX, TS, and TSX. |
| `--references`        | Directory; repeatable    | None                                | Roots to scan for source references.                                            |
| `--reference-include` | Glob pattern; repeatable | Supported source files              | Includes matching reference files.                                              |
| `--reference-exclude` | Glob pattern; repeatable | Generated, minified, and test files | Excludes matching reference files.                                              |

Reference updates are conservative. A reference is rewritten only when it maps
to exactly one discovered image. Dynamic path construction, missing paths, and
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
|   `2` | Invalid options or command usage.                                    |
|   `3` | Processing, configuration, or filesystem failure.                    |
| `130` | Interrupted with Ctrl+C or another abort signal.                     |

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
| `npm run audit:prod`       | Audits production dependencies.                                               |
| `npm run validate:package` | Runs typecheck, lint, formatting, tests, build, publint, and pack validation. |

[Back to contents](#contents)

## License

MIT

[Back to contents](#contents)
