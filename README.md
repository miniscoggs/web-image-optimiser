# web-image-optimiser

Prepares images for websites. `wio` reads PNG, JPEG, WebP, AVIF and SVG files, always strips metadata, and writes the smallest output that stays above a perceptual quality target (SSIMULACRA 2), with a plain-language verdict when degradation would be noticeable.

> **Status:** in development. The package is not published to npm yet: to use `wio`, run `npm install`, `npm run build` and `npm link` in a clone.

## Command line

```sh
wio photos                                        # a WebP beside each image in photos/
wio photos --recursive --out-dir web              # every subfolder too, mirrored into web/
wio hero.jpg --to suite --out-dir web --markup    # AVIF, WebP and a fallback, with <picture> markup
wio photos --dry-run --json                       # what would be written, as JSON
wio compare photo.png photo.webp --diff diff.png  # the score, verdict and size change
wio ui photos                                     # compare the outputs in the browser
```

`--to` picks what to write: `webp` (the default), `avif`, `same` (each file's own format) or `suite` (AVIF, WebP and a JPEG or PNG fallback for `<picture>`). `--target` sets the lowest quality allowed, `high` (80) by default. Every output keeps the input's name with its own extension, beside the input or in `--out-dir`, and replaces an input only with `--in-place` and another existing file only with `--overwrite`. `--json` prints one result for scripts and agents, and the exit code is 0 when nothing failed, 1 when a file failed and 2 for a usage error. `wio ui` serves a comparison UI on 127.0.0.1, behind a session token: pick or drop images, run them, read the results, compare each output with the original (zoomed together, in a wipe or with a diff overlay), try a lossy output at other qualities, and copy the `wio` command that writes them. Its runs write into a temp folder, and the folder served changes only when you Write an output into it. [docs/cli.md](./docs/cli.md) describes every flag.

## Using with AI agents

Agents drive `wio` through its CLI: `--json` prints exactly one result on stdout, `--ndjson` one event per line, and the CLI never prompts. The package ships an agent guide, `dist/SKILL.md` (the root [SKILL.md](./SKILL.md) in this repo), covering which mode to use, the commands to run, how to read the result, the exit codes and the safety rules. To give an agent the skill, copy it into the project:

- **Claude Code:** `.claude/skills/web-image-optimiser/SKILL.md`
- **A repo with `.ai/` steering:** `.ai/skills/web-image-optimiser/SKILL.md`, listed in `.ai/skills.md`

For example, from a project that has the package installed:

```sh
mkdir -p .claude/skills/web-image-optimiser
cp node_modules/web-image-optimiser/dist/SKILL.md .claude/skills/web-image-optimiser/
```

The result's JSON Schema ships too, as `web-image-optimiser/schema/run-result.schema.json`. See [docs/json-contract.md](./docs/json-contract.md).

## Library

The package also exports the functions the CLI is built on: the optimiser, comparisons and markup, and the steps the optimiser is made of, which are image inspection, lossless metadata stripping, SVG optimisation and the perceptual metrics.

| Export                                        | Purpose                                                                                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `optimiseFile(path, options?)`                | Optimises one image in `webp`, `avif`, `same` or `suite` mode and writes the smallest outputs that reach the quality target. See [docs/modes.md](./docs/modes.md)                                         |
| `optimiseBatch(inputs, options?)`             | Optimises many images in parallel on worker threads, with progress events, and resolves to a `RunResult`. See [docs/json-contract.md](./docs/json-contract.md)                                            |
| `compareFiles(original, candidate, options?)` | Scores a candidate image against its original, reports the size saving, and can write a diff map. Resolves to a `CompareResult`                                                                           |
| `generatePictureMarkup(file, options?)`       | Returns the `<picture>` or `<img>` HTML for a file's result, with `width`, `height` and a placeholder `alt`. See [docs/cli.md](./docs/cli.md#markup)                                                      |
| `startUiServer({ root, port? })`              | Starts the server behind `wio ui` on 127.0.0.1 and resolves to its tokenised `url`, an `openFile` that forwards to it, and a `close` function. See [docs/cli.md](./docs/cli.md#comparing-in-the-browser)  |
| `inspect(input)`                              | Reads a file path or bytes and reports the format (from the bytes, not the extension), displayed size, alpha, colour profile and metadata                                                                 |
| `stripLossless(bytes, info)`                  | Removes a JPEG, PNG, WebP or AVIF file's metadata by editing its segments, chunks or boxes, so the pixels are untouched, and lists what it removed                                                        |
| `optimiseSvg(bytes, options?)`                | Optimises an SVG with SVGO at the lowest float precision that still renders the same at 1x and 2x (score 90+), and reports its gzipped size. `options.signal` aborts it. See [docs/svg.md](./docs/svg.md) |
| `stripSvg(bytes)`                             | Removes an SVG's comments, `<metadata>` and editor data, which changes nothing that renders                                                                                                               |
| `decodeForScoring(input, options?)`           | Decodes a file path or encoded bytes into 8-bit sRGB RGBA, with EXIF orientation applied. `options.density` sets the DPI an SVG renders at                                                                |
| `score(reference, distorted)`                 | Resolves to the SSIMULACRA 2 score, 100 for identical pixels. Transparent images are scored on black and on white, and the lower score wins                                                               |
| `verdictFor(score)`                           | Maps a score to `visually-lossless` (90+), `excellent` (85+), `very-high` (80+), `high` (70+), `noticeable` (50+) or `obvious`                                                                            |
| `isScorable(image)`                           | Returns whether an image is at least 8x8, the smallest size SSIMULACRA 2 can score                                                                                                                        |
| `isDownscaledForScoring(image)`               | Returns whether an image is over 26 megapixels, which `score` resizes to 26 MP first, so its score is approximate                                                                                         |
| `createDiffMap(reference, distorted)`         | Returns a PNG heat map of where two images differ                                                                                                                                                         |

```ts
import { optimiseFile } from "web-image-optimiser";

const result = await optimiseFile("photo.jpg", {
  to: "suite",
  target: "high",
  outDir: "web",
});
console.log(result.status, result.warnings);
for (const output of result.outputs) {
  console.log(output.role, output.path, output.bytes, output.score);
}
```

`optimiseBatch(paths, options, { concurrency, onEvent, signal })` runs the same rules over many files and resolves to a `RunResult`, whose shape is published as JSON Schema in `dist/schema/` (exported as `web-image-optimiser/schema/run-result.schema.json`).

`optimiseFile` never writes an output larger than its input, always strips metadata, and only replaces the input with `inPlace` and other existing files with `overwrite`. A problem with the file comes back as a `failed` result with an error code rather than a rejection. `dryRun` reports what would be written without writing it, and an `AbortSignal` passed as `{ signal }` stops the work, leaving no temp files.

Both functions set sharp's thread count for the whole process to 1 (`sharp.concurrency(1)`). With more threads, libaom splits an AVIF into tiles, which makes it larger at the same quality and makes its bytes depend on the machine. Batches run files in parallel on worker threads instead.

```ts
import { decodeForScoring, score, verdictFor } from "web-image-optimiser";

const original = await decodeForScoring("photo.png");
const candidate = await decodeForScoring("photo.webp");
const value = await score(original, candidate);
console.log(value, verdictFor(value));
```

Scoring takes about a second per megapixel, and the WebAssembly step blocks the calling thread while it runs. The scorer has 4 GiB of memory, which holds a pair of up to 26 megapixels.

The step functions throw an `OptimiserError` instead. `inspect` rejects a file it can't handle with one whose `code` is `E_UNSUPPORTED_FORMAT` (not a PNG, JPEG, WebP, AVIF or SVG), `E_ANIMATED` (an animated WebP, APNG or AVIF sequence) or `E_DECODE` (the header can't be read). Branch on the code, which stays stable between releases, rather than on the message.

```ts
import { inspect, OptimiserError } from "web-image-optimiser";

try {
  const info = await inspect("photo.jpg");
  console.log(info.format, info.width, info.height, info.icc, info.metadata);
} catch (error) {
  if (error instanceof OptimiserError) console.error(error.code, error.message);
}
```

## Development

Requires Node.js 24 or later.

```sh
npm install
npm run build
npm run lint
npm test
```

The browser UI behind `wio ui` is a React app in `ui/`, which `npm run build` builds into `dist/ui` with Vite. To work on it with hot reload, run `node dist/bin/index.js ui <folder> --port 5174` after a build, then `npm run dev:ui`, and open `http://127.0.0.1:5173`: the dev server passes API requests to the `wio ui` server, and the browser shares its session.

The SSIMULACRA 2 metric is a Rust crate in `wasm/`, compiled to WebAssembly. Its build output, `wasm/pkg`, is committed, so working on the package needs no Rust. After changing anything in `wasm/`, start Docker and run `npm run build:wasm`. It builds inside a pinned image with checksummed tools, so the output matches CI's rebuild byte for byte, and CI fails when the committed `wasm/pkg` is out of date. `fixtures/ssimulacra2/` holds six image pairs with scores from libjxl's reference `ssimulacra2` tool, and the tests require the WebAssembly build to stay within 0.5 of each. `node wasm/bench.mjs` times one score at 1 MP and 12 MP.

The encoder settings come from a benchmark, described in [docs/encoding.md](./docs/encoding.md). After `npm run build`, `node scripts/bench-encoders.mjs` reruns it.

Test images live in `fixtures/`, and `fixtures/manifest.json` records each one's traits, source and licence. `node fixtures/generate.mjs` rebuilds the synthetic fixtures and the manifest; add `--photos` to re-download the photos and derive them again. The output bytes vary by platform and libvips version, so run it only when changing a fixture, and review every file it rewrites before committing.

The golden tests in `tests/golden/` run every fixture through every mode and compare what the optimiser decides with `tests/golden/golden.json`, allowing quality within 3 and size within 10%. They take a few minutes, most of it on the four photos, so `npm run test:fast` runs everything else in about 20 seconds. CI runs them on Ubuntu for pull requests that change engine files, and on every OS for release pull requests. A change to `golden.json` is a change to what the tool outputs: after `npm run build`, `node scripts/update-golden.mjs` rewrites it, and the `update-image-engine` skill in `.ai/skills/` covers when and how.

The browser test in `tests/browser/` opens the built UI in Google Chrome through Playwright, runs an image, compares it, moves a quality slider and writes the result. It needs Chrome installed and `npm run build` first. `npm run test:browser` runs it alone, `npm run test:fast` leaves it out, and CI runs it on Ubuntu.

## Licence

MIT. See [LICENSE](./LICENSE). The WebAssembly module includes code under the BSD-2-Clause, MIT and Unicode-3.0 licences, and `wasm/pkg/THIRD-PARTY-NOTICES.txt` lists each crate with its licence. The photos in `fixtures/` are CC0, and `fixtures/manifest.json` credits their authors and sources.
