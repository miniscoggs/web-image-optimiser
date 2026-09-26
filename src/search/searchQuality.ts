import type { SearchAttempt, SearchOptions, SearchResult } from "./types.js";

/**
 * Picks the attempt to use: the smallest that passed (then the lowest quality), or, when none
 * passed, the highest-scoring (then the smallest).
 *
 * @param attempts - Every attempt, by ascending quality.
 */
function chooseAttempt<Candidate extends { bytes: Uint8Array }>(
  attempts: SearchAttempt<Candidate>[]
) {
  const passed = attempts.filter((attempt) => attempt.passed);
  const ranked =
    passed.length > 0
      ? passed.toSorted(
          (first, second) =>
            first.candidate.bytes.length - second.candidate.bytes.length
        )
      : attempts.toSorted(
          (first, second) =>
            second.score - first.score ||
            first.candidate.bytes.length - second.candidate.bytes.length
        );

  return ranked[0];
}

/**
 * Finds the lowest integer quality whose encoding reaches a target score, by binary search.
 *
 * The highest quality is tried first, and when even that falls short the search stops there.
 * Otherwise it narrows to the lowest passing quality, assuming the score rises with quality, and
 * then tries one step above it: encoders aren't strictly monotonic, so that step can fail, or
 * pass at a smaller size. Each quality is encoded and scored at most once. The encoder and scorer
 * are injected, so the search itself has no side effects.
 *
 * @param options - The encoder, scorer, target and quality range.
 * @returns The chosen attempt, every attempt, and whether the target was reached.
 * @throws RangeError when the range is empty.
 *
 * @example
 * ```ts
 * const result = await searchQuality({
 *   encode: (quality) => webpLossy(source, quality),
 *   score: (candidate) => decodeForScoring(candidate.bytes).then((image) => score(source, image)),
 *   target: 80,
 *   range: [30, 95],
 * });
 * ```
 */
async function searchQuality<Candidate extends { bytes: Uint8Array }>(
  options: SearchOptions<Candidate>
): Promise<SearchResult<Candidate>> {
  const [lowest, highest] = options.range;

  if (
    !Number.isInteger(lowest) ||
    !Number.isInteger(highest) ||
    lowest > highest
  ) {
    throw new RangeError(
      `Expected an integer quality range, got ${lowest} to ${highest}`
    );
  }

  const tried = new Map<number, SearchAttempt<Candidate>>();
  const attempt = async (quality: number) => {
    const cached = tried.get(quality);

    if (cached !== undefined) {
      return cached;
    }

    const candidate = await options.encode(quality);
    const score = await options.score(candidate);
    const result = {
      quality,
      candidate,
      score,
      passed: score >= options.target,
    };

    tried.set(quality, result);
    return result;
  };

  if ((await attempt(highest)).passed) {
    let low = lowest;
    let high = highest; // always passes

    while (low < high) {
      const middle = Math.floor((low + high) / 2);

      if ((await attempt(middle)).passed) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    if (high < highest) {
      await attempt(high + 1);
    }
  }

  const attempts = [...tried.values()].toSorted(
    (first, second) => first.quality - second.quality
  );
  const chosen = chooseAttempt(attempts);

  if (chosen === undefined) {
    throw new Error("searchQuality made no attempts"); // unreachable: the highest is always tried
  }
  return { chosen, attempts, reached: chosen.passed };
}

export default searchQuality;
