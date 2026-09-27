import { createRequire } from "node:module";
import { isSourceRun } from "../runtime/index.js";

type Ssimulacra2Module = {
  score(
    reference: Uint8Array,
    distorted: Uint8Array,
    width: number,
    height: number
  ): number;
};

let loaded:
  | { module: Ssimulacra2Module; path: string; require: NodeJS.Require }
  | undefined;

/**
 * Scores two 8-bit sRGB RGB images with the SSIMULACRA 2 WASM module, loading it on first use.
 *
 * A trap, such as running out of WASM memory, leaves the instance unusable, so it's discarded
 * and the next call loads a fresh one.
 *
 * @param reference - The original's RGB pixels.
 * @param distorted - The distorted image's RGB pixels.
 * @param width - Width of both images.
 * @param height - Height of both images.
 */
function scoreSsimulacra2(
  reference: Uint8Array,
  distorted: Uint8Array,
  width: number,
  height: number
) {
  if (!loaded) {
    const require = createRequire(import.meta.url);
    const path = require.resolve(
      isSourceRun(import.meta.url) // src/ has no dist/wasm copy
        ? "../../wasm/pkg/ssimulacra2.js"
        : "../wasm/ssimulacra2.js"
    );

    loaded = { module: require(path) as Ssimulacra2Module, path, require }; // compiles the wasm, so never at import time
  }

  try {
    return loaded.module.score(reference, distorted, width, height);
  } catch (error) {
    if (error instanceof Error && error.name === "RuntimeError") {
      // a wasm trap; WebAssembly isn't in this project's type libs
      delete loaded.require.cache[loaded.path];
      loaded = undefined;
    }
    throw error;
  }
}

export default scoreSsimulacra2;
