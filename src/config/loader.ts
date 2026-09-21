import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import type { ImageSlimConfig } from "../types/public";

const CONFIG_NAMES = [
  "image-slim.config.ts",
  "image-slim.config.mts",
  "image-slim.config.js",
  "image-slim.config.mjs",
  "image-slim.config.cjs",
];

export async function loadConfig(
  requestedPath: string | undefined,
  cwd = process.cwd(),
): Promise<{ config: ImageSlimConfig; path?: string }> {
  const configPath = requestedPath
    ? resolve(cwd, requestedPath)
    : CONFIG_NAMES.map((name) => resolve(cwd, name)).find(existsSync);

  if (!configPath) {
    return { config: {} };
  }

  if (!existsSync(configPath)) {
    throw new Error(`Configuration file was not found: ${configPath}`);
  }

  const jiti = createJiti(configPath, { interopDefault: true });
  const loaded = (await jiti.import(configPath)) as unknown;
  const config =
    loaded && typeof loaded === "object" && "default" in loaded
      ? (loaded.default as ImageSlimConfig)
      : (loaded as ImageSlimConfig);

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Configuration file must export an object: ${configPath}`);
  }

  return { config, path: configPath };
}
