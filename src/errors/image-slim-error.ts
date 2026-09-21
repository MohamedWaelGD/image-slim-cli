export type ImageSlimErrorCode =
  | "INVALID_INPUT"
  | "INVALID_OPTIONS"
  | "INPUT_NOT_FOUND"
  | "UNSUPPORTED_FORMAT"
  | "DECODE_FAILED"
  | "ENCODE_FAILED"
  | "OUTPUT_COLLISION"
  | "OUTPUT_UNSAFE"
  | "UNSAFE_INPUT"
  | "REFERENCE_UPDATE_FAILED"
  | "ABORTED";

export class ImageSlimError extends Error {
  override readonly name = "ImageSlimError";

  constructor(
    readonly code: ImageSlimErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
