import { open } from "node:fs/promises";
import { SNIFF_BYTES, detectFormat } from "./detectFormat.js";

/**
 * Reads enough of a file to detect its format from its bytes.
 *
 * @param filePath - The file.
 * @returns The format, or `undefined` when it can't be read or isn't supported.
 */
async function sniffFormat(filePath: string) {
  try {
    const handle = await open(filePath);

    try {
      const { buffer, bytesRead } = await handle.read(
        Buffer.alloc(SNIFF_BYTES),
        0,
        SNIFF_BYTES,
        0
      );

      return detectFormat(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

export default sniffFormat;
