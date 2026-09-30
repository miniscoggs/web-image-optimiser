// a ref is file/<n>/<name>, a file the desktop app opened, or session/<path in the app's temp
// folder>, a run's output or a diff map

/**
 * Returns the address the app serves a ref's file at.
 *
 * @param ref - The ref.
 */
function imageUrl(ref: string) {
  return `/api/image/${encodeURIComponent(ref)}`;
}

export { imageUrl };
