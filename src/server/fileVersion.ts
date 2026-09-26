import { stat } from "node:fs/promises";

/**
 * Returns a string that changes whenever a file is replaced or modified, from its file ID,
 * modification time and size, so a cache keyed by it never serves an old version.
 *
 * @param filePath - The file.
 */
async function fileVersion(filePath: string) {
  const stats = await stat(filePath, { bigint: true });

  return [stats.ino, stats.mtimeNs, stats.size].join(":");
}

export default fileVersion;
