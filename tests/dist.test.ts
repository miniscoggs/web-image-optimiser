import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Library = typeof import("../src/index.js");

const DIST_ENTRY = new URL("../dist/index.js", import.meta.url);
const PAIR_DIR = new URL("../fixtures/ssimulacra2/", import.meta.url);

// dist exists only after `npm run build`, which CI runs before the tests
describe.skipIf(!existsSync(DIST_ENTRY))("built package", () => {
  it("scores through the wasm copied into dist/wasm", async () => {
    const library = (await import(DIST_ENTRY.href)) as Library;
    const reference = await library.decodeForScoring(
      fileURLToPath(new URL("butterfly.png", PAIR_DIR))
    );
    const distorted = await library.decodeForScoring(
      fileURLToPath(new URL("butterfly-q60.webp", PAIR_DIR))
    );

    await expect(library.score(reference, distorted)).resolves.toBeCloseTo(
      68.08, // libjxl's reference score for this pair
      0
    );
  });
});
