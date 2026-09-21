import { ImageSlimError } from "../errors/image-slim-error";

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
};

export function parseByteSize(value: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(value);
  if (!match) {
    throw new ImageSlimError("INVALID_OPTIONS", `Invalid byte size: ${value}.`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const bytes = amount * (UNITS[unit] ?? 1);

  if (!Number.isSafeInteger(Math.round(bytes)) || bytes <= 0) {
    throw new ImageSlimError(
      "INVALID_OPTIONS",
      `Byte size is out of range: ${value}.`,
    );
  }

  return Math.round(bytes);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
