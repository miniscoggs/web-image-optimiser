# web-image-optimiser

Prepares images for websites. `wio` reads PNG, JPEG, WebP, AVIF and SVG files, always strips metadata, and writes the smallest output that stays above a perceptual quality target (SSIMULACRA 2), with a plain-language verdict when degradation would be noticeable.

> **Status:** in development. The package is not published to npm yet, and the CLI has no commands yet.

## Library

The package also exports the functions the CLI is built on. So far, these are the perceptual metrics:

| Export                                | Purpose                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `decodeForScoring(input)`             | Decodes a file path or encoded bytes into 8-bit sRGB RGBA, with EXIF orientation applied                                                    |
| `score(reference, distorted)`         | Resolves to the SSIMULACRA 2 score, 100 for identical pixels. Transparent images are scored on black and on white, and the lower score wins |
| `verdictFor(score)`                   | Maps a score to `visually-lossless` (90+), `excellent` (85+), `very-high` (80+), `high` (70+), `noticeable` (50+) or `obvious`              |
| `isScorable(image)`                   | Returns whether an image is at least 8x8, the smallest size SSIMULACRA 2 can score                                                          |
| `isDownscaledForScoring(image)`       | Returns whether an image is over 26 megapixels, which `score` resizes to 26 MP first, so its score is approximate                           |
| `createDiffMap(reference, distorted)` | Returns a PNG heat map of where two images differ                                                                                           |

```ts
import { decodeForScoring, score, verdictFor } from "web-image-optimiser";

const original = await decodeForScoring("photo.png");
const candidate = await decodeForScoring("photo.webp");
const value = await score(original, candidate);
console.log(value, verdictFor(value));
```

Scoring takes about a second per megapixel, and the WebAssembly step blocks the calling thread while it runs. The scorer has 4 GiB of memory, which holds a pair of up to 26 megapixels.

## Development

Requires Node.js 24 or later.

```sh
npm install
npm run build
npm run lint
npm test
```

The SSIMULACRA 2 metric is a Rust crate in `wasm/`, compiled to WebAssembly. Its build output, `wasm/pkg`, is committed, so working on the package needs no Rust. After changing anything in `wasm/`, start Docker and run `npm run build:wasm`. It builds inside a pinned image with checksummed tools, so the output matches CI's rebuild byte for byte, and CI fails when the committed `wasm/pkg` is out of date. `fixtures/ssimulacra2/` holds six image pairs with scores from libjxl's reference `ssimulacra2` tool, and the tests require the WebAssembly build to stay within 0.5 of each. `node wasm/bench.mjs` times one score at 1 MP and 12 MP.

Test images live in `fixtures/`, and `fixtures/manifest.json` records each one's traits, source and licence. `node fixtures/generate.mjs` rebuilds the synthetic fixtures and the manifest; add `--photos` to re-download the photos and derive them again. The output bytes vary by platform and libvips version, so run it only when changing a fixture, and review every file it rewrites before committing.

## Licence

MIT. See [LICENSE](./LICENSE). The WebAssembly module includes code under the BSD-2-Clause, MIT and Unicode-3.0 licences, and `wasm/pkg/THIRD-PARTY-NOTICES.txt` lists each crate with its licence. The photos in `fixtures/` are CC0, and `fixtures/manifest.json` credits their authors and sources.
