import { constants, gzipSync } from "node:zlib";

/**
 * Returns an SVG's size once gzipped, as a server precompressing static files would.
 *
 * @param bytes - The SVG.
 */
function gzipSize(bytes: Buffer) {
  return gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION }).length;
}

export default gzipSize;
