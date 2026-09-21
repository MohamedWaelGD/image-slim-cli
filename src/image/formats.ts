import type { ImageFormat } from "../types/public";

export type OutputFormat = Exclude<ImageFormat, "original">;

export function normalizeImageFormat(
  format: string | undefined,
): OutputFormat | undefined {
  if (!format) return undefined;
  if (format === "jpg") return "jpeg";
  return ["jpeg", "png", "webp"].includes(format)
    ? (format as OutputFormat)
    : undefined;
}

export function mimeForFormat(format: OutputFormat): string {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}
