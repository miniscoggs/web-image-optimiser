import type { EncodeFormat } from "../encode/index.js";
import type { InspectFormat } from "../inspect/index.js";
import { isOpaque } from "../metrics/composite.js";
import { isDownscaledForScoring } from "../metrics/index.js";
import type { Candidate, ChosenCandidate } from "./candidate.js";
import { rasterCandidates, stripCandidate } from "./rasterCandidates.js";
import type { RasterSource } from "./rasterCandidates.js";
import type {
  PipelineMode,
  PipelineOutputRole,
  PipelineWarning,
} from "./types.js";

const FORMAT_NAMES: Record<InspectFormat, string> = {
  avif: "AVIF",
  jpeg: "JPEG",
  png: "PNG",
  svg: "SVG",
  webp: "WebP",
};

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
  candidates: Candidate[],
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
 * Chooses the one output of `same`, `webp` or `avif` mode.
 *
 * A conversion may fall short of the target, with `W_TARGET_NOT_REACHED`, because it is what was
 * asked for. When nothing in the format is smaller than the input, the lossless strip is written
 * instead, with `W_NOT_CONVERTED` if that means another format.
 *
 * @param source - The source.
 * @param format - The format to write.
 * @param role - The output's role.
 * @param inputBytes - The input's size.
 * @param warnings - Collects the warnings.
 */
async function selectSingle(
  source: RasterSource,
  format: EncodeFormat,
  role: PipelineOutputRole,
  inputBytes: number,
  warnings: PipelineWarning[]
): Promise<ChosenCandidate[]> {
  const converting = format !== source.format;
  const { candidates, unavailable } = await rasterCandidates(format, source);
  const best = pickCandidate(candidates, inputBytes, source.target, converting);

  if (best !== undefined) {
    if (best.score < source.target) {
      warnings.push({
        code: "W_TARGET_NOT_REACHED",
        message: `The best ${FORMAT_NAMES[format]} scores ${best.score.toFixed(1)}, below the target of ${source.target}`,
      });
    }
    return [{ ...best, role }];
  }
  if (converting) {
    const name = FORMAT_NAMES[format];
    const reason =
      unavailable ??
      (candidates.length === 0
        ? `No ${name} was tried, as the image is too small to score` // lossy formats need a score
        : `No ${name} was smaller than the input`);

    warnings.push({
      code: "W_NOT_CONVERTED",
      message: `${reason}, so the file stays in ${FORMAT_NAMES[source.format]}`,
    });
  }
  return source.strip.removed.length > 0
    ? [{ ...stripCandidate(source), role: "same" }]
    : [];
}

/**
 * Chooses the outputs of `suite` mode: a fallback (PNG when any pixel is transparent,
 * otherwise the smaller of JPEG and PNG), then a WebP only if it's smaller than the fallback,
 * then an AVIF only if it's smaller than the WebP. Each must reach the target and be smaller
 * than the input, except that a JPEG or PNG input may be its own fallback, unchanged.
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
  const results = await Promise.all(
    roles.map(([, formats]) =>
      Promise.all(formats.map((format) => rasterCandidates(format, source)))
    )
  );
  const chosen: ChosenCandidate[] = [];
  let below = inputBytes + 1; // the unchanged input may be the fallback, so a page always has one

  for (const [index, [role]] of roles.entries()) {
    const candidates = (results[index] ?? []).flatMap(
      (result) => result.candidates
    );
    const best = pickCandidate(candidates, below, source.target, false);

    if (best === undefined) {
      below = Math.min(below, inputBytes);
    } else {
      chosen.unshift({ ...best, role });
      below = best.bytes.length;
    }
  }
  return chosen;
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
  const warnings: PipelineWarning[] = [];

  if (!source.scorable) {
    warnings.push({
      code: "W_TOO_SMALL_TO_SCORE",
      message: `Images under 8x8 pixels can't be scored, so only lossless outputs were tried`,
    });
  } else if (isDownscaledForScoring(source.image)) {
    warnings.push({
      code: "W_SCORED_DOWNSCALED",
      message:
        "The image is over 26 megapixels, so it was scored at 26 MP and its scores are approximate",
    });
  }

  const chosen =
    mode === "suite"
      ? await selectSuite(source, inputBytes)
      : await selectSingle(
          source,
          mode === "same" ? source.format : mode,
          mode,
          inputBytes,
          warnings
        );

  return { chosen, warnings };
}

export default selectRaster;
