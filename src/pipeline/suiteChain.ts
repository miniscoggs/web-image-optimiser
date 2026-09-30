// imports nothing, so the ui can bundle it

/**
 * Returns which of a suite's outputs the chain rule keeps: the fallback, then the WebP only when
 * it's smaller than the last output kept, then the AVIF only when it's smaller than the last
 * output kept.
 *
 * @param sizes - The fallback's, the WebP's and the AVIF's sizes in bytes, in that order, with
 * `undefined` for a role that has nothing to keep.
 * @returns Whether each is kept, in the same order.
 */
function keptBySuiteChain(sizes: readonly (number | undefined)[]) {
  let below = Infinity;

  return sizes.map((size) => {
    const kept = size !== undefined && size < below;

    if (kept) {
      below = size;
    }
    return kept;
  });
}

export default keptBySuiteChain;
