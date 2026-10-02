import type {
  SearchAttempt,
  SearchAttemptContext,
  SearchOptions,
  SearchResult,
} from "./types.js";

/**
 * Where a search stands: about to try the highest quality, narrowing to the lowest passing
 * quality from `low` to `high`, or about to try the step above `high`.
 */
type SearchStep =
  | { phase: "highest" }
  | { phase: "narrow"; low: number; high: number }
  | { phase: "above"; high: number };

/**
 * An attempt the search has started, on its path or ahead of it.
 */
type StartedAttempt<Candidate> = {
  result: Promise<SearchAttempt<Candidate>>;
  /** Drops it while it is ahead of need. */
  drop: AbortController;
};

/**
 * Returns the quality a step tries.
 *
 * @param step - The step.
 * @param range - The quality range.
 */
function qualityAt(step: SearchStep, range: readonly [number, number]) {
  if (step.phase === "highest") {
    return range[1];
  }
  return step.phase === "narrow"
    ? Math.floor((step.low + step.high) / 2)
    : step.high + 1;
}

/**
 * Returns the step after one, once its quality has passed or failed.
 *
 * @param step - The step.
 * @param passed - Whether its quality passed.
 * @param range - The quality range.
 * @returns The next step, or `undefined` when the search is done.
 */
function stepAfter(
  step: SearchStep,
  passed: boolean,
  range: readonly [number, number]
): SearchStep | undefined {
  const [lowest, highest] = range;
  const narrowed = (low: number, high: number): SearchStep | undefined => {
    if (low < high) {
      return { phase: "narrow", low, high };
    }
    return high < highest ? { phase: "above", high } : undefined;
  };

  if (step.phase === "highest") {
    return passed ? narrowed(lowest, highest) : undefined; // the target is out of reach
  }
  if (step.phase === "narrow") {
    const middle = qualityAt(step, range);

    return passed
      ? narrowed(step.low, middle)
      : narrowed(middle + 1, step.high);
  }
  return undefined;
}

/**
 * Lists every quality the search could still need after a step, nearest first: the steps after
 * each outcome of this one, then theirs, following only the known outcome of a quality that has
 * finished.
 *
 * @param step - The step the search is on.
 * @param range - The quality range.
 * @param finished - The attempts that have finished, on the search's path or ahead of it.
 */
function qualitiesAhead<Candidate>(
  step: SearchStep,
  range: readonly [number, number],
  finished: Map<number, SearchAttempt<Candidate>>
) {
  const ahead = new Set<number>();
  const queue: SearchStep[] = [];
  const queueAfter = (from: SearchStep) => {
    const known = finished.get(qualityAt(from, range));

    for (const passed of known === undefined ? [true, false] : [known.passed]) {
      const next = stepAfter(from, passed, range);

      if (next !== undefined) {
        queue.push(next);
      }
    }
  };

  queueAfter(step);
  for (const next of queue) {
    ahead.add(qualityAt(next, range));
    queueAfter(next); // visited later in this loop
  }
  ahead.delete(qualityAt(step, range)); // the step above can be the one running
  return [...ahead];
}

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
 * With `lookahead`, while it waits for an attempt it starts the ones it could need next, both
 * outcomes' and then theirs, up to that many unfinished, and drops any it can no longer reach.
 * An attempt that has finished, even ahead of need, leads only to its own outcome's. It still
 * follows exactly the path it would one at a time, and only that path's attempts are chosen
 * from or returned, so the result is the same for any scorer, even one whose scores don't rise
 * with quality.
 *
 * @param options - The encoder, scorer, target and quality range, and how far to run ahead.
 * @returns The chosen attempt, every attempt on its path, and whether the target was reached.
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
  const { range, target, signal } = options;
  const [lowest, highest] = range;

  if (
    !Number.isInteger(lowest) ||
    !Number.isInteger(highest) ||
    lowest > highest
  ) {
    throw new RangeError(
      `Expected an integer quality range, got ${lowest} to ${highest}`
    );
  }

  const started = new Map<number, StartedAttempt<Candidate>>();
  const finished = new Map<number, SearchAttempt<Candidate>>();
  const onPath = new Set<number>(); // the qualities the search has reached
  const tried = new Map<number, SearchAttempt<Candidate>>();

  const start = (quality: number) => {
    const existing = started.get(quality);

    if (existing !== undefined) {
      return existing;
    }

    const drop = new AbortController();
    const context: SearchAttemptContext = {
      signal:
        signal === undefined
          ? drop.signal
          : AbortSignal.any([signal, drop.signal]),
      speculative: () => !onPath.has(quality),
    };
    const run = async () => {
      const candidate = await options.encode(quality, context);
      const score = await options.score(candidate, context);
      const attempt = { quality, candidate, score, passed: score >= target };

      finished.set(quality, attempt);
      return attempt;
    };
    const attempt = { result: run(), drop };

    void attempt.result.catch(() => undefined); // only an attempt the search reaches can fail it
    started.set(quality, attempt);
    return attempt;
  };

  const runAhead = (step: SearchStep) => {
    const ahead = qualitiesAhead(step, range, finished);
    const reachable = new Set(ahead);
    const limit = Math.max(0, options.lookahead?.() ?? 0);
    const unfinished = ahead.filter((quality) => !finished.has(quality));

    for (const quality of unfinished.slice(0, limit)) {
      start(quality);
    }
    for (const [quality, attempt] of started) {
      if (!onPath.has(quality) && !reachable.has(quality)) {
        attempt.drop.abort();
      }
    }
  };

  let step: SearchStep | undefined = { phase: "highest" };

  try {
    while (step !== undefined) {
      signal?.throwIfAborted();

      const quality = qualityAt(step, range);

      onPath.add(quality);

      const needed = start(quality);

      runAhead(step);

      const attempt = await needed.result;

      tried.set(quality, attempt);
      step = stepAfter(step, attempt.passed, range);
    }
  } finally {
    for (const [quality, attempt] of started) {
      if (!onPath.has(quality)) {
        attempt.drop.abort(); // no longer needed
      }
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
