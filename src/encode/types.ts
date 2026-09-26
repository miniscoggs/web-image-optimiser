const ENCODE_METHODS = ["lossy", "lossless", "near-lossless"] as const;

/**
 * An output format the encoders write.
 */
type EncodeFormat = "webp" | "avif" | "jpeg" | "png";

/**
 * How an encoder compresses: `lossy`, `lossless`, or `near-lossless` (WebP's lossless mode on
 * slightly adjusted pixels).
 */
type EncodeMethod = (typeof ENCODE_METHODS)[number];

/**
 * An encoded candidate.
 */
type EncodeResult = {
  /** The encoded file, with no metadata. */
  bytes: Buffer;
  format: EncodeFormat;
  method: EncodeMethod;
  /** The quality it was encoded at, for the encoders that take one. */
  quality?: number;
};

export { ENCODE_METHODS };
export type { EncodeFormat, EncodeMethod, EncodeResult };
