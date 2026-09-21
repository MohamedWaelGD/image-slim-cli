/**
 * End-to-end validation of the actual npm artifact.
 *
 * Builds the package, packs it, installs the tarball into an isolated project,
 * and exercises the public CLI and both module entry points. This catches
 * packaging mistakes that the repository test suite cannot see.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function execCommand(command, args, cwd) {
  const options = {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  };
  if (process.platform === "win32") {
    // Node refuses to spawn .cmd shims directly on Windows.
    const line = [command, ...args]
      .map((part) => (/\s/.test(part) ? `"${part}"` : part))
      .join(" ");
    return execSync(line, options);
  }
  return execFileSync(command, args, options);
}

function run(args, cwd) {
  return execCommand(npm, args, cwd);
}

function runNode(args, cwd) {
  return execCommand(process.execPath, args, cwd);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Package validation failed: ${message}`);
}

const ALLOWED_PREFIXES = ["dist/", "README.md", "LICENSE", "package.json"];

async function main() {
  console.log("Building package...");
  run(["run", "build"], root);

  console.log("Packing package...");
  const rawPack = run(["pack", "--json"], root);
  const jsonStart = rawPack.indexOf("{");
  const jsonEnd = rawPack.lastIndexOf("}");
  const parsed = JSON.parse(rawPack.slice(jsonStart, jsonEnd + 1));
  // npm returns an array in some versions and an object keyed by package name in others.
  const packs = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const pack = packs[0];
  const tarball = join(root, pack.filename);
  const paths = pack.files.map((file) => file.path);

  console.log(`Inspecting ${pack.filename} (${paths.length} files)...`);
  for (const path of paths) {
    const allowed = ALLOWED_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(prefix),
    );
    assert(allowed, `unexpected file in tarball: ${path}`);
  }
  for (const required of [
    "dist/index.js",
    "dist/index.cjs",
    "dist/index.d.ts",
    "dist/bin.js",
    "README.md",
    "LICENSE",
  ]) {
    assert(paths.includes(required), `missing from tarball: ${required}`);
  }

  const project = await mkdtemp(join(tmpdir(), "image-slim-package-"));
  try {
    console.log(`Installing tarball into ${project}...`);
    await writeFile(
      join(project, "package.json"),
      JSON.stringify(
        { name: "image-slim-package-test", private: true },
        null,
        2,
      ),
    );
    run(
      [
        "install",
        tarball,
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--loglevel=error",
      ],
      project,
    );

    console.log("Checking CLI wiring...");
    const version = run(
      ["exec", "--", "image-slim", "--version"],
      project,
    ).trim();
    assert(version.includes("0.1.0"), `unexpected version output: ${version}`);
    const help = run(["exec", "--", "image-slim", "--help"], project);
    assert(
      help.includes("image-slim"),
      "help output is missing the command name",
    );

    console.log("Generating a fixture image...");
    await mkdir(join(project, "images"), { recursive: true });
    await writeFile(
      join(project, "make-image.mjs"),
      [
        'import sharp from "sharp";',
        "await sharp({",
        "  create: {",
        "    width: 128,",
        "    height: 128,",
        "    channels: 3,",
        "    background: { r: 30, g: 120, b: 200 },",
        "  },",
        '}).jpeg({ quality: 100 }).toFile("images/hero.jpg");',
      ].join("\n"),
    );
    runNode(["make-image.mjs"], project);

    console.log("Running a real conversion...");
    run(
      [
        "exec",
        "--",
        "image-slim",
        "./images",
        "--format",
        "webp",
        "--allow-larger",
        "--progress",
        "never",
      ],
      project,
    );
    await readFile(join(project, "optimized", "hero.webp"));

    console.log("Checking the ESM entry point...");
    await writeFile(
      join(project, "check.mjs"),
      [
        'import { optimizeDirectory, checkImages } from "@mohamedwaelgd/image-slim-cli";',
        'if (typeof optimizeDirectory !== "function") throw new Error("optimizeDirectory missing");',
        'if (typeof checkImages !== "function") throw new Error("checkImages missing");',
        'const result = await checkImages(["./images"]);',
        'if (typeof result.hasUnoptimizedFiles !== "boolean") throw new Error("checkImages result invalid");',
        'console.log("esm ok");',
      ].join("\n"),
    );
    assert(
      runNode(["check.mjs"], project).includes("esm ok"),
      "ESM import failed",
    );

    console.log("Checking the CommonJS entry point...");
    await writeFile(
      join(project, "check.cjs"),
      [
        'const api = require("@mohamedwaelgd/image-slim-cli");',
        'if (typeof api.optimizeDirectory !== "function") throw new Error("optimizeDirectory missing");',
        'if (typeof api.defineConfig !== "function") throw new Error("defineConfig missing");',
        'console.log("cjs ok");',
      ].join("\n"),
    );
    assert(
      runNode(["check.cjs"], project).includes("cjs ok"),
      "CJS require failed",
    );

    console.log("\nPackage validation passed.");
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(tarball, { force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
