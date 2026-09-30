import type { EncodeFormat } from "../encode/index.js";
import FORMAT_NAMES from "../inspect/formatNames.js";
import { isOpaque } from "../metrics/composite.js";
import { isDownscaledForScoring } from "../metrics/index.js";
import { OptimiserError } from "../schema/index.js";
import type { ChosenCandidate, RasterCandidate } from "./candidate.js";
import DOWNSCALED_WARNING from "./downscaledWarning.js";
import { rasterCandidates, stripCandidate } from "./rasterCandidates.js";
import type { RasterSource } from "./rasterCandidates.js";
import { rightsWarnings, withRights } from "./sourceRights.js";
import type { RightsTier } from "./sourceRights.js";
import keptBySuiteChain from "./suiteChain.js";
import type {
  PipelineMode,
  PipelineOutputRole,
  PipelineWarning,
} from "./types.js";

/**
 * Picks the smallest candidate that is smaller than a size and reaches the target, or, when
 * allowed and none does, the highest-scoring one that is smaller.
 *
 * @param candidates - The candidates.
 * @param below - The size a candidate must be under.
 * @param target - The target score.
 * @param allowBelowTarget - Whether a candidate below the target may be picked.
 */
function pickCandidate(
  candidates: RasterCandidate[],
  below: number,
  target: number,
  allowBelowTarget: boolean
) {
  const smaller = candidates.filter(
    (candidate) => candidate.bytes.length < below
  );
  const passing = smaller
    .filter((candidate) => candidate.score >= target)
    .toSorted((first, second) => first.bytes.length - second.bytes.length);

  if (passing.length > 0 || !allowBelowTarget) {
    return passing[0];
  }
  return smaller.toSorted(
    (first, second) =>
      second.score - first.score || first.bytes.length - second.bytes.length
  )[0];
}

/**
 * Returns candidates carrying a tier's rights, leaving out any whose format can't hold them.
 *
 * @param candidates - The candidates, holding no XMP.
 * @param tier - The rights.
 */
function withTier(candidates: RasterCandidate[], tier: RightsTier) {
  return candidates.flatMap((candidate) => withRights(candidate, tier));
}

/**
 * Picks a candidate as {@link pickCandidate} does, carrying the first tier of rights that leaves
 * one to pick, so fields are dropped only when none with more would be under the size.
 *
 * @param candidates - The candidates, holding no XMP.
 * @param tiers - The rights to try, most first.
 * @param below - The size a candidate must be under.
 * @param target - The target score.
 * @param allowBelowTarget - Whether a candidate below the target may be picked.
 */
function pickCarrying(
  candidates: RasterCandidate[],
  tiers: readonly RightsTier[],
  below: number,
  target: number,
  allowBelowTarget: boolean
) {
  for (const tier of tiers) {
    const best = pickCandidate(
      withTier(candidates, tier), // lazily, so a tier's packet is only written once the ones before it fail
      below,
      target,
      allowBelowTarget
    );

    if (best !== undefined) {
      return best;
    }
  }
  return undefined;
}

/**
 * Returns the size a suite's output must be under: the input's, except that a fallback may be
 * the unchanged input, unless it was resized, so a page always has one.
 *
 * @param source - The source.
 * @param role - The output's role.
 * @param inputBytes - The input's size.
 */
function suiteBound(
  source: RasterSource,
  role: PipelineOutputRole,
  inputBytes: number
) {
  return role === "fallback" && source.strip !== undefined
    ? inputBytes + 1
    : inputBytes;
}

/**
 * Warns when the source's candidates couldn't be scored as usual: an image too small to score,
 * or too large to score at its full size.
 *
 * @param source - The source.
 */
function sourceWarnings(source: RasterSource): PipelineWarning[] {
  if (!source.scorable) {
    return [
      {
        code: "W_TOO_SMALL_TO_SCORE",
        message: `Images under 8x8 pixels can't be scored, so only lossless outputs were tried`,
      },
    ];
  }
  return isDownscaledForScoring(source.image) ? [DOWNSCALED_WARNING] : [];
}

/**
 * Chooses the one output of `same`, `webp` or `avif` mode.
 *
 * A conversion may fall short of the target, with `W_TARGET_NOT_REACHED`, because it is what was
 * asked for. When nothing in the format is smaller than the input, the lossless strip is written
 * instead, with `W_NOT_CONVERTED` if that means another format. A resized source has no strip,
 * so a conversion falls back to the smallest passing re-encode in the input's own format. Each
 * tier of rights is tried in turn, and the output carries the first that leaves it smaller than
 * the input.
 *
 * @param source - The source.
 * @param format - The format to write.
 * @param role - The output's role.
 * @param inputBytes - The input's size.
 * @returns The output, if any, and the warnings.
 */
async function selectSingle(
  source: RasterSource,
  format: EncodeFormat,
  role: PipelineOutputRole,
  inputBytes: number
): Promise<{ chosen: ChosenCandidate[]; warnings: PipelineWarning[] }> {
  const converting = format !== source.format;
  const { candidates, unavailable } = await rasterCandidates(format, source);
  const name = FORMAT_NAMES[format];
  const smallerBare = candidates.some(
    (candidate) => candidate.bytes.length < inputBytes
  ); // then only the rights made them larger
  const reason =
    unavailable ??
    (candidates.length === 0
      ? `No ${name} was tried, as the image is too small to score` // lossy formats need a score
      : `No ${name}${smallerBare ? " carrying the rights fields" : ""} was smaller than the input`);
  const notConverted: PipelineWarning[] = converting
    ? [
        {
          code: "W_NOT_CONVERTED",
          message: `${reason}, so the file stays in ${FORMAT_NAMES[source.format]}`,
        },
      ]
    : [];
  let fallbacks: RasterCandidate[] | undefined; // in the input's own format, made when first needed

  for (const tier of source.rights.tiers) {
    const best = pickCandidate(
      withTier(candidates, tier),
      inputBytes,
      source.target,
      converting
    );

    if (best !== undefined) {
      const warnings: PipelineWarning[] =
        best.score < source.target
          ? [
              {
                code: "W_TARGET_NOT_REACHED",
                message: `The best ${name} scores ${best.score.toFixed(1)}, below the target of ${source.target}`,
              },
            ]
          : [];

      return { chosen: [{ ...best, role }], warnings };
    }
    if (converting) {
      fallbacks ??=
        source.strip === undefined
          ? (await rasterCandidates(source.format, source)).candidates // resized, so a re-encode at the new width
          : [stripCandidate(source.format, source.strip)];

      const fallback = pickCandidate(
        withTier(fallbacks, tier),
        inputBytes,
        source.target,
        false
      );

      if (fallback !== undefined) {
        return {
          chosen: [{ ...fallback, role: "same" }],
          warnings: notConverted,
        };
      }
    }
  }
  return { chosen: [], warnings: notConverted };
}

/**
 * Chooses the outputs of `suite` mode: a fallback (PNG when any pixel is transparent,
 * otherwise the smaller of JPEG and PNG), then a WebP only if it's smaller than the fallback,
 * then an AVIF only if it's smaller than the WebP. Each must reach the target and be smaller
 * than the input, except that a JPEG or PNG input may be its own fallback, unchanged, unless it
 * was resized. Each output carries the first tier of rights that leaves one of its candidates
 * smaller than the input.
 *
 * @param source - The source.
 * @param inputBytes - The input's size.
 * @returns The outputs, AVIF first.
 */
async function selectSuite(source: RasterSource, inputBytes: number) {
  const fallbackFormats: EncodeFormat[] = isOpaque(source.image)
    ? ["jpeg", "png"]
    : ["png"];
  const roles: [PipelineOutputRole, EncodeFormat[]][] = [
    ["fallback", fallbackFormats],
    ["webp", ["webp"]],
    ["avif", ["avif"]],
  ];
  const bests = await Promise.all(
    roles.map(async ([role, formats]) => {
      const results = await Promise.all(
        formats.map((format) => rasterCandidates(format, source))
      );
      const candidates = results.flatMap((result) => result.candidates);

      return pickCarrying(
        candidates,
        source.rights.tiers,
        suiteBound(source, role, inputBytes), // under the input rather than the chain's bound, so the chain never drops fields
        source.target,
        false
      );
    })
  );
  const kept = keptBySuiteChain(bests.map((best) => best?.bytes.length));

  return roles
    .flatMap(([role], index): ChosenCandidate[] => {
      const best = bests[index];

      return best !== undefined && kept[index] === true
        ? [{ ...best, role }]
        : [];
    })
    .toReversed();
}

/**
 * Chooses one format's output as `suite` chooses each of its own, apart from the chain rule, for
 * the app's target sliders. When nothing in the format reaches the target under the input's
 * size, it takes the best carrying the most fields the format can hold instead, which may fall
 * short of the target or be larger than the input.
 *
 * @param source - The source.
 * @param format - The format.
 * @param inputBytes - The input's size.
 * @returns The output, and the warnings.
 * @throws {@link OptimiserError} `E_TOO_LARGE_FOR_FORMAT` when the format can't hold the image,
 * or `E_TOO_SMALL_TO_SCORE` when the image is too small to score and the format is lossy.
 */
async function selectFormat(
  source: RasterSource,
  format: EncodeFormat,
  inputBytes: number
) {
  const { candidates, unavailable } = await rasterCandidates(format, source);
  const { tiers } = source.rights;
  const role = format === "webp" || format === "avif" ? format : "fallback";
  const chosen =
    pickCarrying(
      candidates,
      tiers,
      suiteBound(source, role, inputBytes),
      source.target,
      false
    ) ?? pickCarrying(candidates, tiers, Infinity, source.target, true);

  if (chosen === undefined) {
    throw unavailable === undefined
      ? new OptimiserError(
          "E_TOO_SMALL_TO_SCORE",
          `Images under 8x8 pixels can't be scored, so no ${FORMAT_NAMES[format]} was tried`
        )
      : new OptimiserError("E_TOO_LARGE_FOR_FORMAT", unavailable);
  }

  const warnings = [
    ...sourceWarnings(source),
    ...rightsWarnings(source.rights, [chosen]),
  ];

  return { chosen, warnings };
}

/**
 * Chooses a raster input's outputs for a mode.
 *
 * @param source - The source.
 * @param mode - The mode.
 * @param inputBytes - The input's size.
 * @returns The outputs, AVIF first, and the warnings. No outputs means the input is kept.
 */
async function selectRaster(
  source: RasterSource,
  mode: PipelineMode,
  inputBytes: number
) {
  const warnings = sourceWarnings(source);
  const selected =
    mode === "suite"
      ? { chosen: await selectSuite(source, inputBytes), warnings: [] }
      : await selectSingle(
          source,
          mode === "same" ? source.format : mode,
          mode,
          inputBytes
        );
  const { chosen } = selected;

  warnings.push(...selected.warnings);
  if (chosen.length === 0 && source.strip === undefined) {
    // resized
    warnings.push({
      code: "W_NOT_RESIZED",
      message: `Nothing ${source.image.width} pixels wide was smaller than the input and reached the target, so the file keeps its size`,
    });
  }
  warnings.push(...rightsWarnings(source.rights, chosen));
  return { chosen, warnings };
}

export { selectFormat, selectRaster };
