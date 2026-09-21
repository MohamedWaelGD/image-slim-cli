import { DEFAULT_CONFIG } from "./defaults";
import type { ImageSlimConfig, RunOptions } from "../types/public";

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

export function mergeConfig(
  fileConfig: ImageSlimConfig,
  cliOptions: RunOptions,
): ImageSlimConfig {
  const fileReferences = defined(fileConfig.references ?? {});
  const cliReferences = defined(cliOptions.references ?? {});
  const config = {
    ...DEFAULT_CONFIG,
    ...defined(fileConfig),
    ...defined(cliOptions),
  } as ImageSlimConfig;

  config.exclude = [
    ...(DEFAULT_CONFIG.exclude ?? []),
    ...(fileConfig.exclude ?? []),
    ...(cliOptions.exclude ?? []),
  ];
  config.include = [
    ...(fileConfig.include ?? []),
    ...(cliOptions.include ?? []),
  ];
  config.references = {
    ...DEFAULT_CONFIG.references,
    ...fileReferences,
    ...cliReferences,
    include: [
      ...(DEFAULT_CONFIG.references?.include ?? []),
      ...(fileConfig.references?.include ?? []),
      ...(cliReferences.include ?? []),
    ],
    exclude: [
      ...(DEFAULT_CONFIG.references?.exclude ?? []),
      ...(fileConfig.references?.exclude ?? []),
      ...(cliReferences.exclude ?? []),
    ],
  };

  if (cliOptions.updateReferences !== undefined) {
    config.updateReferences = cliOptions.updateReferences;
  } else if (fileConfig.updateReferences !== undefined) {
    config.updateReferences = fileConfig.updateReferences;
  } else if (fileConfig.references?.update !== undefined) {
    config.updateReferences = fileConfig.references.update;
  }

  config.inputs = cliOptions.inputs?.length
    ? cliOptions.inputs
    : fileConfig.input
      ? Array.isArray(fileConfig.input)
        ? fileConfig.input
        : [fileConfig.input]
      : undefined;

  return config;
}
