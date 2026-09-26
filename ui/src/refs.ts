// a ref is root/<path in the folder served> or session/<path in the server's temp folder>

/**
 * Returns whether a ref is an uploaded file rather than one in the folder served.
 *
 * @param ref - The ref.
 */
function isUpload(ref: string) {
  return ref.startsWith("session/uploads/");
}

/**
 * Returns how to show a ref: its path in the folder served, or an upload's file name.
 *
 * @param ref - The ref.
 */
function displayName(ref: string) {
  return isUpload(ref)
    ? ref.slice(ref.lastIndexOf("/") + 1)
    : ref.replace(/^root\//, "");
}

/**
 * Returns the address the server serves a ref's file at.
 *
 * @param ref - The ref.
 */
function imageUrl(ref: string) {
  return `/api/image/${encodeURIComponent(ref)}`;
}

export { displayName, imageUrl, isUpload };
