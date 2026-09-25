import { createRequire } from "node:module";

type Ssimulacra2Module = {
  score(
    reference: Uint8Array,
    distorted: Uint8Array,
    width: number,
    height: number
  ): number;
};

let loaded: { module: Ssimulacra2Module; path: string } | undefined;

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
  const require = createRequire(import.meta.url);

  if (!loaded) {
    const sourceRun = new URL(import.meta.url).pathname.endsWith(".ts"); // tests run src/, which has no dist/wasm copy
    const path = require.resolve(
      sourceRun ? "../../wasm/pkg/ssimulacra2.js" : "../wasm/ssimulacra2.js"
    );

    loaded = { module: require(path) as Ssimulacra2Module, path }; // compiles the wasm, so never at import time
  }

  try {
    return loaded.module.score(reference, distorted, width, height);
  } catch (error) {
    if (error instanceof Error && error.name === "RuntimeError") {
      // a wasm trap; WebAssembly isn't in this project's type libs
      delete require.cache[loaded.path];
      loaded = undefined;
    }
    throw error;
  }
}

export default scoreSsimulacra2;
