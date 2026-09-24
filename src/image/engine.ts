import { readFile, stat } from "node:fs/promises";
import sharp, { type Metadata, type OutputInfo, type Sharp } from "sharp";
import { ImageSlimError } from "../errors/image-slim-error";
import { parseByteSize } from "../filesystem/size";
import { normalizeImageFormat, type OutputFormat } from "./formats";
import type { ImageMetadata, OptimizationOptions } from "../types/public";

export interface EncodedImage {
  data: Buffer;
  metadata: ImageMetadata;
  quality: number;
  targetSizeReached: boolean;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ImageSlimError("ABORTED", "Image optimization was interrupted.", {
      cause: signal.reason,
    });
  }
}

function metadataFromSharp(
  metadata: Metadata,
  size: number,
  fallbackFormat: string,
): ImageMetadata {
  return {
    size,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    format: metadata.format ?? fallbackFormat,
    hasAlpha: metadata.hasAlpha,
    orientation: metadata.orientation,
    pages: metadata.pages,
  };
}

function outputFormat(
  input: ImageMetadata,
  requested: OptimizationOptions["format"],
): OutputFormat {
  if (requested && requested !== "original") return requested;
  const format = normalizeImageFormat(input.format);
  if (!format) {
    throw new ImageSlimError(
      "UNSUPPORTED_FORMAT",
      `Unsupported image format: ${input.format}.`,
    );
  }
  return format;
}

function buildPipeline(
  input: Buffer,
  inputMetadata: ImageMetadata,
  options: OptimizationOptions,
  format: OutputFormat,
): Sharp {
  let pipeline = sharp(input).rotate();
  if (options.maxWidth || options.maxHeight) {
    pipeline = pipeline.resize({
      width: options.maxWidth,
      height: options.maxHeight,
      fit: "inside",
      withoutEnlargement: !options.allowUpscale,
    });
  }

  if (format === "jpeg" && inputMetadata.hasAlpha) {
    pipeline = pipeline.flatten({
      background: options.background ?? "#ffffff",
    });
  }

  if (options.metadata === "keep") pipeline = pipeline.withMetadata();
  return pipeline;
}

async function encode(
  pipeline: Sharp,
  format: OutputFormat,
  quality: number,
): Promise<{ data: Buffer; info: OutputInfo }> {
  const configured =
    format === "jpeg"
      ? pipeline.jpeg({ quality, progressive: true, mozjpeg: true })
      : format === "webp"
        ? pipeline.webp({ quality })
        : format === "avif"
          ? pipeline.avif({ quality })
          : pipeline.png({
              compressionLevel: 9,
              adaptiveFiltering: true,
              palette: false,
            });

  try {
    return await configured.toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new ImageSlimError("ENCODE_FAILED", "Image encoding failed.", {
      cause: error,
    });
  }
}

async function findTarget(
  pipeline: Sharp,
  format: OutputFormat,
  targetSize: number,
  maxQuality: number,
  minQuality: number,
  signal?: AbortSignal,
): Promise<EncodedImage> {
  assertNotAborted(signal);
  if (format === "png") {
    const encoded = await encode(pipeline.clone(), format, maxQuality);
    return {
      data: encoded.data,
      metadata: {
        size: encoded.data.byteLength,
        width: encoded.info.width ?? 0,
        height: encoded.info.height ?? 0,
        format,
      },
      quality: maxQuality,
      targetSizeReached: encoded.data.byteLength <= targetSize,
    };
  }

  const minimumQuality = Math.min(minQuality, maxQuality);
  const highest = await encode(pipeline.clone(), format, maxQuality);
  if (highest.data.byteLength <= targetSize) {
    return {
      data: highest.data,
      metadata: {
        size: highest.data.byteLength,
        width: highest.info.width ?? 0,
        height: highest.info.height ?? 0,
        format,
      },
      quality: maxQuality,
      targetSizeReached: true,
    };
  }

  const lowest = await encode(pipeline.clone(), format, minimumQuality);
  if (lowest.data.byteLength > targetSize) {
    return {
      data: lowest.data,
      metadata: {
        size: lowest.data.byteLength,
        width: lowest.info.width ?? 0,
        height: lowest.info.height ?? 0,
        format,
      },
      quality: minimumQuality,
      targetSizeReached: false,
    };
  }

  let low = minimumQuality;
  let high = maxQuality;
  let best = lowest;
  let bestQuality = minimumQuality;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    assertNotAborted(signal);
    const quality = Math.round((low + high) / 2);
    const current = await encode(pipeline.clone(), format, quality);
    if (current.data.byteLength <= targetSize) {
      best = current;
      bestQuality = quality;
      low = quality;
    } else {
      high = quality;
    }
  }

  return {
    data: best.data,
    metadata: {
      size: best.data.byteLength,
      width: best.info.width ?? 0,
      height: best.info.height ?? 0,
      format,
    },
    quality: bestQuality,
    targetSizeReached: true,
  };
}

export async function inspectImage(path: string): Promise<ImageMetadata> {
  try {
    const info = await sharp(path, { animated: true }).metadata();
    const fileSize = (await stat(path)).size;
    return metadataFromSharp(
      info,
      fileSize,
      path.slice(path.lastIndexOf(".") + 1).toLowerCase(),
    );
  } catch (error) {
    if (error instanceof ImageSlimError) throw error;
    throw new ImageSlimError(
      "DECODE_FAILED",
      `Unable to decode image: ${path}`,
      { cause: error },
    );
  }
}

export async function encodeImage(
  path: string,
  options: OptimizationOptions,
): Promise<{ input: ImageMetadata; output: EncodedImage }> {
  let input: Buffer;
  let metadata: Metadata;
  try {
    input = await readFile(path);
    metadata = await sharp(input, { animated: true }).metadata();
  } catch (error) {
    throw new ImageSlimError(
      "DECODE_FAILED",
      `Unable to decode image: ${path}`,
      { cause: error },
    );
  }

  const inputMetadata = metadataFromSharp(
    metadata,
    input.byteLength,
    path.slice(path.lastIndexOf(".") + 1).toLowerCase(),
  );
  if ((metadata.pages ?? 1) > 1) {
    throw new ImageSlimError(
      "ANIMATED_IMAGE",
      "Animated images are skipped to preserve their frames.",
    );
  }
  const format = outputFormat(inputMetadata, options.format);
  const pipeline = buildPipeline(input, inputMetadata, options, format);
  const targetSize =
    typeof options.targetSize === "string"
      ? parseByteSize(options.targetSize)
      : options.targetSize;
  const output = targetSize
    ? await findTarget(
        pipeline,
        format,
        targetSize,
        options.quality ?? 82,
        options.minQuality ?? 40,
        options.signal,
      )
    : (() =>
        encode(pipeline, format, options.quality ?? 82).then((encoded) => ({
          data: encoded.data,
          metadata: {
            size: encoded.data.byteLength,
            width: encoded.info.width ?? 0,
            height: encoded.info.height ?? 0,
            format,
          },
          quality: options.quality ?? 82,
          targetSizeReached: true,
        })))();

  return { input: inputMetadata, output: await output };
}
