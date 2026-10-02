/**
 * What {@link searchQuality} tells its encoder and scorer about one attempt.
 */
type SearchAttemptContext = {
  /**
   * Aborts when the search's own signal does, or when the search drops the attempt, which it
   * does only to one made ahead of need that it can no longer reach.
   */
  signal: AbortSignal;
  /**
   * Whether the attempt is still ahead of need, so its work can wait behind needed work. It
   * turns false once the search reaches it.
   */
  speculative: () => boolean;
};

/**
 * What {@link searchQuality} needs: an encoder and a scorer for one format, the target score
 * and the quality range to search.
 */
type SearchOptions<Candidate extends { bytes: Uint8Array }> = {
  /** Encodes the image at a quality. */
  encode: (
    quality: number,
    attempt: SearchAttemptContext
  ) => Promise<Candidate>;
  /** Scores a candidate against the original, from 100 downwards. */
  score: (
    candidate: Candidate,
    attempt: SearchAttemptContext
  ) => Promise<number>;
  /** The lowest passing score. */
  target: number;
  /** The lowest and highest integer quality to try, inclusive. */
  range: readonly [number, number];
  /**
   * How many attempts may run ahead of the one the search needs, read at each step, so it can
   * change as the search goes. None by default.
   */
  lookahead?: () => number;
  /** Stops the search starting attempts, rejecting with its reason. */
  signal?: AbortSignal;
};

/**
 * One quality {@link searchQuality} tried.
 */
type SearchAttempt<Candidate> = {
  quality: number;
  candidate: Candidate;
  score: number;
  /** Whether the score reached the target. */
  passed: boolean;
};

/**
 * The result of {@link searchQuality}.
 */
type SearchResult<Candidate> = {
  /**
   * The smallest passing attempt, or, when none passed, the highest-scoring one.
   */
  chosen: SearchAttempt<Candidate>;
  /** Every attempt on the search's path, by ascending quality. */
  attempts: SearchAttempt<Candidate>[];
  /** Whether any attempt reached the target. */
  reached: boolean;
};

export type {
  SearchAttempt,
  SearchAttemptContext,
  SearchOptions,
  SearchResult,
};
