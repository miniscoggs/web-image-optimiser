/**
 * What {@link searchQuality} needs: an encoder and a scorer for one format, the target score
 * and the quality range to search.
 */
type SearchOptions<Candidate extends { bytes: Uint8Array }> = {
  /** Encodes the image at a quality. */
  encode: (quality: number) => Promise<Candidate>;
  /** Scores a candidate against the original, from 100 downwards. */
  score: (candidate: Candidate) => Promise<number>;
  /** The lowest passing score. */
  target: number;
  /** The lowest and highest integer quality to try, inclusive. */
  range: readonly [number, number];
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
  /** Every attempt, by ascending quality. */
  attempts: SearchAttempt<Candidate>[];
  /** Whether any attempt reached the target. */
  reached: boolean;
};

export type { SearchAttempt, SearchOptions, SearchResult };
