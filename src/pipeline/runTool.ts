import { createRequire } from "node:module";
import sharp from "sharp";

/**
 * Returns the versions of web-image-optimiser, sharp and libvips, which a run's result records
 * because encoded bytes vary between them.
 */
function runTool() {
  const require = createRequire(import.meta.url);
  const manifest = require("../../package.json") as { version: string }; // two levels up from both src/ and dist/

  return {
    version: manifest.version,
    sharp: sharp.versions.sharp,
    libvips: sharp.versions.vips,
  };
}

export default runTool;
