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
import { isOpaque } from "../metrics/composite.js";
import { decodeForScoring, isScorable, score } from "../metrics/index.js";
import type {
  MetricsImage,
  MetricsScoreOptions,
  MetricsScorePool,
} from "../metrics/index.js";
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
 * An encoder's result and its score against the source.
 */
type RasterScoredEncode = EncodeResult & { score: number };

/**
 * What searches of one input file at one maximum width can share, so a search at another
 * target takes what earlier ones made instead of making it again: the decoded pixels, and each
 * candidate encoded and scored, by encoder and quality. The app keeps one per file between
 * its target searches. Encodes are deterministic with sharp's threads pinned, so a kept
 * candidate is the one a new encode would give, and neither the target nor the rights enter
 * it, since candidates carry no rights until selection writes them in.
 */
type RasterCache = {
  fitted: { image: MetricsImage; resized: boolean } | undefined;
  attempts: Map<string, Promise<RasterScoredEncode>>;
};

/**
 * How one candidate's encode and score run: the signal that stops them, and whether a search
 * is making it ahead of need, so its score waits behind needed ones.
 */
type RasterAttempt = Pick<MetricsScoreOptions, "signal" | "speculative">;

/**
 * What a raster input's candidates are made with, besides its settings.
 */
type RasterContext = {
  /** Aborts the encodes, and drops the scores still waiting for a thread. */
  signal?: AbortSignal;
  /** Scores the candidates on its threads; without one, they're scored on the calling thread. */
  scorePool?: MetricsScorePool;
  /** What earlier searches of the same file at the same maximum width made, to take from and add to; only the app keeps one. */
  cache?: RasterCache;
};

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
  /** How many quality searches are running, which share the pool's scorers. */
  searches: { running: number };
} & RasterContext;

/**
 * Creates an empty {@link RasterCache}, for the searches of one input file at one maximum width.
 */
function createRasterCache(): RasterCache {
  return { fitted: undefined, attempts: new Map() };
}

/**
 * Shrinks decoded pixels wider than a maximum width to exactly that width, keeping the aspect
 * ratio, with sharp's default Lanczos 3, which premultiplies alpha.
 *
 * @param image - The decoded pixels, orientation applied, so the width is as displayed.
 * @param width - The maximum width, if any.
 * @returns The shrunk pixels, or the image itself when it is no wider.
 */
async function fitToWidth(
  image: MetricsImage,
  width: number | undefined
): Promise<MetricsImage> {
  if (width === undefined || image.width <= width) {
    return image;
  }

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
 * Decodes an input, shrinking it when it is wider than the maximum width.
 *
 * @param bytes - The input file.
 * @param maxWidth - The maximum width, if any.
 * @throws {@link OptimiserError} `E_DECODE` when the image data can't be decoded.
 */
async function decodeFitted(bytes: Buffer, maxWidth: number | undefined) {
  const decoded = await readOrFail(() => decodeForScoring(bytes));
  const image = await fitToWidth(decoded, maxWidth);

  return { image, resized: image !== decoded };
}

/**
 * Decodes and strips a raster input once, for every candidate to share, shrinking it first when
 * it is wider than the maximum width, and works out the rights its outputs may carry.
 *
 * @param bytes - The input file.
 * @param info - What `inspect` reported about it.
 * @param settings - The target score, the maximum width and the rights options.
 * @param context - The signal, the pool to score on and the cache, each if any.
 * @throws {@link OptimiserError} `E_DECODE` when the image data can't be decoded.
 */
async function createRasterSource(
  bytes: Buffer,
  info: InspectResult & { format: StripFormat },
  settings: Pick<
    PipelineSettings,
    "target" | "maxWidth" | "stripAll" | "rights"
  >,
  context: RasterContext = {}
): Promise<RasterSource> {
  const { target, maxWidth } = settings;
  const { cache } = context;
  const fitted = cache?.fitted ?? (await decodeFitted(bytes, maxWidth));
  const { image, resized } = fitted;

  if (cache !== undefined) {
    cache.fitted = fitted;
  }

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
    searches: { running: 0 },
    ...context,
  };
}

/**
 * Scores encoded bytes against the source.
 *
 * @param bytes - The encoded candidate.
 * @param source - The source.
 * @param attempt - The signal that drops the score while it waits, and whether it's ahead of need.
 */
async function scoreBytes(
  bytes: Buffer,
  source: RasterSource,
  attempt: RasterAttempt
) {
  const decoded = await decodeForScoring(bytes);

  return score(source.image, decoded, { ...attempt, pool: source.scorePool });
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
 * Encodes a candidate and scores it against the source, or takes it from the source's cache
 * when an earlier search of the same file made it. A failure isn't kept, and one taken from the
 * cache, such as an attempt an earlier search made ahead of need and then dropped, is made again.
 *
 * @param key - The encoder's name and quality, which with the cache's file and maximum width
 * decide the candidate.
 * @param encode - Encodes the source.
 * @param source - The source.
 * @param attempt - The signal that stops it, and whether it's ahead of need.
 */
function scoredEncode(
  key: string,
  encode: () => Promise<EncodeResult>,
  source: RasterSource,
  attempt: RasterAttempt = { signal: source.signal }
): Promise<RasterScoredEncode> {
  const attempts = source.cache?.attempts;
  const make = () => {
    attempt.signal?.throwIfAborted();

    const made = encode().then(async (encoded) => {
      attempt.signal?.throwIfAborted(); // eg dropped while it encoded

      return {
        ...encoded,
        score: await scoreBytes(encoded.bytes, source, attempt),
      };
    });

    if (attempts !== undefined) {
      attempts.set(key, made);
      void made.catch(() => {
        if (attempts.get(key) === made) {
          attempts.delete(key);
        }
      });
    }
    return made;
  };
  const kept = attempts?.get(key);

  return kept === undefined ? make() : kept.catch(() => make());
}

/**
 * Returns how many attempts each of a source's running searches may make ahead of need: the
 * pool's scorers left once each search's needed attempt has its own, split evenly. None
 * without a pool, whose calling thread scores one pair at a time.
 *
 * @param source - The source.
 */
function lookaheadFor(source: RasterSource) {
  const { scorePool, searches, image } = source;

  if (scorePool === undefined) {
    return 0;
  }

  const neededPairs = searches.running * (isOpaque(image) ? 1 : 2); // transparency scores on two backgrounds

  return Math.max(0, Math.floor(scorePool.size / neededPairs) - 1);
}

/**
 * Searches an encoder's quality range for the smallest encoding that reaches the target,
 * running ahead of need on the pool's spare scorers.
 *
 * @param name - Names the encoder in the source's cache.
 * @param encode - Encodes the source at a quality.
 * @param range - The qualities to search.
 * @param source - The source.
 */
async function searchedCandidate(
  name: string,
  encode: (quality: number) => Promise<EncodeResult>,
  range: readonly [number, number],
  source: RasterSource
) {
  const { searches } = source;

  searches.running++;
  try {
    await Promise.resolve(); // so the searches a selection starts together all count before any runs ahead

    const { chosen } = await searchQuality({
      encode: (quality, attempt) =>
        scoredEncode(
          `${name} ${quality}`,
          () => encode(quality),
          source,
          attempt
        ),
      score: (scored) => Promise.resolve(scored.score),
      target: source.target,
      range,
      lookahead: () => lookaheadFor(source),
      signal: source.signal,
    });

    return toCandidate(chosen.candidate, chosen.score, source);
  } finally {
    searches.running--;
  }
}

/**
 * Encodes and scores a candidate from an encoder with no quality setting.
 *
 * @param name - Names the encoder in the source's cache.
 * @param encode - Encodes the source.
 * @param source - The source.
 */
async function losslessCandidate(
  name: string,
  encode: () => Promise<EncodeResult>,
  source: RasterSource
) {
  const scored = await scoredEncode(name, encode, source);

  return toCandidate(scored, scored.score, source);
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
      name: string,
      encode: (quality: number) => Promise<EncodeResult>,
      range: readonly [number, number]
    ) =>
    () =>
      searchedCandidate(name, encode, range, source);
  const exact = (name: string, encode: () => Promise<EncodeResult>) => () =>
    losslessCandidate(name, encode, source);

  if (format === "png") {
    return [
      exact("png lossless", () => pngLossless(image)),
      ...(scorable
        ? [
            search(
              "png palette",
              (quality) => pngPalette(image, quality),
              QUALITY_RANGES.png
            ),
          ]
        : []),
    ];
  }
  if (format === "jpeg") {
    return scorable
      ? [
          search(
            "jpeg",
            (quality) => jpegMozjpeg(image, quality),
            QUALITY_RANGES.jpeg
          ),
        ]
      : [];
  }
  if (format === "avif") {
    return scorable
      ? [
          search(
            "avif",
            (quality) => avifLossy(image, quality),
            QUALITY_RANGES.avif
          ),
        ]
      : [];
  }

  const losslessOnly = source.losslessWebp || !scorable;
  const fromPng = source.format === "png";
  const nearLossless = (step: number) =>
    webpNearLossless(image, step * NEAR_LOSSLESS_STEP);

  return [
    ...(losslessOnly
      ? []
      : [
          search(
            "webp",
            (quality) => webpLossy(image, quality),
            QUALITY_RANGES.webp
          ),
        ]),
    ...(losslessOnly || fromPng
      ? [exact("webp lossless", () => webpLossless(image))]
      : []),
    ...(fromPng && scorable
      ? [search("webp near-lossless", nearLossless, NEAR_LOSSLESS_STEPS)]
      : []),
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

export {
  createRasterCache,
  createRasterSource,
  fitToWidth,
  rasterCandidates,
  stripCandidate,
};
export type { RasterCache, RasterContext, RasterScoredEncode, RasterSource };
