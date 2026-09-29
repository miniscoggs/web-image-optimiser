import sharp from "sharp";
import {
  QUALITY_RANGES,
  avifLossy,
  jpegMozjpeg,
  pngLossless,
  pngPalette,
  webpLossless,
  webpLossy,
  webpNearLossless,
} from "../encode/index.js";
import type { EncodeFormat, EncodeResult } from "../encode/index.js";
import type { InspectResult } from "../inspect/index.js";
import readOrFail from "../inspect/readOrFail.js";
import { isLosslessWebp } from "../inspect/riffChunks.js";
import { decodeForScoring, isScorable, score } from "../metrics/index.js";
import type { MetricsImage } from "../metrics/index.js";
import { OptimiserError } from "../schema/index.js";
import { searchQuality } from "../search/index.js";
import { stripLossless } from "../strip/index.js";
import type {
  StripFormat,
  StripRemovedKind,
  StripResult,
} from "../strip/index.js";
import type { RasterCandidate } from "./candidate.js";
import type { PipelineSettings } from "./resolveSettings.js";
import { createSourceRights } from "./sourceRights.js";
import type { SourceRights } from "./sourceRights.js";

const NEAR_LOSSLESS_STEP = 20; // libwebp only tells levels 20 apart, and 100 is lossless
const NEAR_LOSSLESS_STEPS = [1, 4] as const; // levels 20 to 80

/**
 * A raster input, decoded once, with everything its candidates share.
 */
type RasterSource = {
  /** The decoded pixels every candidate starts from and is scored against, at the maximum width when the input was wider. */
  image: MetricsImage;
  format: StripFormat;
  /** The lossless strip of the input, which is `bytes` itself when nothing was removed. Absent when the image was resized, since a strip keeps the input's size. */
  strip: StripResult | undefined;
  /** What a re-encode drops: everything the strip does, plus orientation and any profile. */
  reencodeStripped: StripRemovedKind[];
  /** The rights its outputs may carry. Candidates hold none until selection writes them in. */
  rights: SourceRights;
  losslessWebp: boolean;
  scorable: boolean;
  target: number;
  signal: AbortSignal | undefined;
};

/**
 * Shrinks decoded pixels to a width, keeping the aspect ratio, with sharp's default Lanczos 3,
 * which premultiplies alpha.
 *
 * @param image - The decoded pixels.
 * @param width - The new width, smaller than the image's.
 */
async function resizeToWidth(
  image: MetricsImage,
  width: number
): Promise<MetricsImage> {
  const height = Math.max(1, Math.round((image.height * width) / image.width));
  const raw = {
    width: image.width,
    height: image.height,
    channels: 4,
  } as const;
  const data = await sharp(image.data, { raw })
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();

  return { data, width, height };
}

/**
 * Decodes and strips a raster input once, for every candidate to share, shrinking it first when
 * it is wider than the maximum width, and works out the rights its outputs may carry.
 *
 * @param bytes - The input file.
 * @param info - What `inspect` reported about it.
 * @param settings - The target score, the maximum width and the rights options.
 * @param signal - Aborts the encodes.
 * @throws {@link OptimiserError} `E_DECODE` when the image data can't be decoded.
 */
async function createRasterSource(
  bytes: Buffer,
  info: InspectResult & { format: StripFormat },
  settings: Pick<
    PipelineSettings,
    "target" | "maxWidth" | "stripAll" | "rights"
  >,
  signal: AbortSignal | undefined
): Promise<RasterSource> {
  const { target, maxWidth = Infinity } = settings;
  const decoded = await readOrFail(() => decodeForScoring(bytes));
  const resized = decoded.width > maxWidth; // the width as displayed, after orientation
  const image = resized ? await resizeToWidth(decoded, maxWidth) : decoded;
  const strip = stripLossless(bytes, info);
  const profile: StripRemovedKind[] = info.icc === null ? [] : ["icc"];
  const reencodeStripped = new Set([
    ...strip.removed,
    ...info.metadata,
    ...profile,
  ]);

  return {
    image,
    format: info.format,
    strip: resized ? undefined : strip,
    reencodeStripped: [...reencodeStripped].toSorted(),
    rights: createSourceRights(
      bytes,
      info.format,
      info.rights ?? {},
      strip,
      settings
    ),
    losslessWebp: info.format === "webp" && isLosslessWebp(bytes),
    scorable: isScorable(image),
    target,
    signal,
  };
}

/**
 * Scores encoded bytes against the source.
 *
 * @param bytes - The encoded candidate.
 * @param source - The source.
 */
async function scoreBytes(bytes: Buffer, source: RasterSource) {
  const decoded = await decodeForScoring(bytes);

  return score(source.image, decoded);
}

/**
 * Turns an encoder's result and its score into a candidate.
 *
 * @param encoded - The encoder's result.
 * @param encodedScore - Its score.
 * @param source - The source.
 */
function toCandidate(
  encoded: EncodeResult,
  encodedScore: number,
  source: RasterSource
): RasterCandidate {
  return {
    format: encoded.format,
    method: encoded.method,
    bytes: encoded.bytes,
    ...(encoded.quality === undefined ? {} : { quality: encoded.quality }),
    score: encodedScore,
    strippedMetadata: source.reencodeStripped,
  };
}

/**
 * Searches an encoder's quality range for the smallest encoding that reaches the target.
 *
 * @param encode - Encodes the source at a quality.
 * @param range - The qualities to search.
 * @param source - The source.
 */
async function searchedCandidate(
  encode: (quality: number) => Promise<EncodeResult>,
  range: readonly [number, number],
  source: RasterSource
) {
  const { chosen } = await searchQuality({
    encode: (quality) => {
      source.signal?.throwIfAborted();
      return encode(quality);
    },
    score: (encoded) => scoreBytes(encoded.bytes, source),
    target: source.target,
    range,
  });

  return toCandidate(chosen.candidate, chosen.score, source);
}

/**
 * Encodes and scores a candidate from an encoder with no quality setting.
 *
 * @param encode - Encodes the source.
 * @param source - The source.
 */
async function losslessCandidate(
  encode: () => Promise<EncodeResult>,
  source: RasterSource
) {
  source.signal?.throwIfAborted();

  const encoded = await encode();

  return toCandidate(encoded, await scoreBytes(encoded.bytes, source), source);
}

/**
 * Returns the re-encodes worth trying in a format, each as a function that makes the candidate.
 *
 * Images too small to score get only lossless encoders. PNG adds a palette search to lossless,
 * which a photo fails at its top quality, ending its search there. A PNG source also tries
 * lossless and near-lossless WebP, and a lossless WebP stays lossless.
 *
 * @param format - The output format.
 * @param source - The source.
 */
function reencodersFor(format: EncodeFormat, source: RasterSource) {
  const { image, scorable } = source;
  const search =
    (
      encode: (quality: number) => Promise<EncodeResult>,
      range: readonly [number, number]
    ) =>
    () =>
      searchedCandidate(encode, range, source);
  const exact = (encode: () => Promise<EncodeResult>) => () =>
    losslessCandidate(encode, source);

  if (format === "png") {
    return [
      exact(() => pngLossless(image)),
      ...(scorable
        ? [search((quality) => pngPalette(image, quality), QUALITY_RANGES.png)]
        : []),
    ];
  }
  if (format === "jpeg") {
    return scorable
      ? [search((quality) => jpegMozjpeg(image, quality), QUALITY_RANGES.jpeg)]
      : [];
  }
  if (format === "avif") {
    return scorable
      ? [search((quality) => avifLossy(image, quality), QUALITY_RANGES.avif)]
      : [];
  }

  const losslessOnly = source.losslessWebp || !scorable;
  const fromPng = source.format === "png";
  const nearLossless = (step: number) =>
    webpNearLossless(image, step * NEAR_LOSSLESS_STEP);

  return [
    ...(losslessOnly
      ? []
      : [search((quality) => webpLossy(image, quality), QUALITY_RANGES.webp)]),
    ...(losslessOnly || fromPng ? [exact(() => webpLossless(image))] : []),
    ...(fromPng && scorable ? [search(nearLossless, NEAR_LOSSLESS_STEPS)] : []),
  ];
}

/**
 * Returns the lossless strip of the source as a candidate, which scores 100 because its image
 * data is untouched.
 *
 * @param format - The source's format.
 * @param strip - Its strip.
 */
function stripCandidate(
  format: StripFormat,
  strip: StripResult
): RasterCandidate {
  return {
    format,
    method: "strip",
    bytes: strip.bytes,
    score: 100,
    strippedMetadata: strip.removed,
  };
}

/**
 * Makes every candidate in one format: the searched and lossless re-encodes, plus the strip
 * when the source is already in that format and wasn't resized.
 *
 * The re-encodes run concurrently, so sharp encodes in the background while the main thread
 * scores.
 *
 * @param format - The output format.
 * @param source - The source.
 * @returns The candidates, and why there are none when the format can't hold the image.
 */
async function rasterCandidates(format: EncodeFormat, source: RasterSource) {
  const strip =
    format === source.format && source.strip !== undefined
      ? [stripCandidate(source.format, source.strip)]
      : [];

  try {
    const reencodes = await Promise.all(
      reencodersFor(format, source).map((make) => make())
    );

    return { candidates: [...strip, ...reencodes] };
  } catch (error) {
    if (
      error instanceof OptimiserError &&
      error.code === "E_TOO_LARGE_FOR_FORMAT"
    ) {
      return { candidates: strip, unavailable: error.message };
    }
    throw error;
  }
}

export { createRasterSource, rasterCandidates, stripCandidate };
export type { RasterSource };
