import { availableParallelism, totalmem } from "node:os";

const SCORER_MEMORY = 4 * 1024 ** 3; // a scorer's wasm memory grows to 4 GiB on a 26 MP image

/**
 * Returns how many scores to run at once by default: one fewer than the CPUs, and no more than
 * the memory holds at a scorer's worst case.
 */
function defaultConcurrency() {
  const byCpu = availableParallelism() - 1;
  const byMemory = Math.floor(totalmem() / SCORER_MEMORY);

  return Math.max(1, Math.min(byCpu, byMemory));
}

/**
 * Splits a batch's concurrency, the scores it runs at once, over its lanes: one lane per file,
 * up to the concurrency, each with an even share, and the first lanes one more when it doesn't
 * divide. So a batch of fewer files than the concurrency scores each file's candidates side by
 * side, and a larger one scores one at a time in each lane.
 *
 * @param concurrency - How many scores run at once, at least 1.
 * @param files - How many files the batch has.
 * @returns How many scores each lane runs at once, one entry per lane.
 */
function laneScorers(concurrency: number, files: number) {
  const lanes = Math.min(concurrency, files);

  return Array.from(
    { length: lanes },
    (_, lane) =>
      Math.floor(concurrency / lanes) + (lane < concurrency % lanes ? 1 : 0)
  );
}

/**
 * Returns how many threads a child process's libuv pool needs for the scores it runs at once:
 * half as many again as its scorers, and at least libuv's default of 4. A search keeps about as
 * many attempts in flight as its scorers, each a sharp encode, then a decode, on that pool.
 *
 * @param scorers - How many scores the child runs at once.
 */
function libuvThreads(scorers: number) {
  return Math.max(4, Math.floor(scorers * 1.5)); // within 3% of twice as many threads' speed, on 9 scorers
}

export { defaultConcurrency, laneScorers, libuvThreads };
