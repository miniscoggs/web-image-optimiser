# Design patterns

## Data flow

Every file must move through one pipeline, with each stage in its own module under `src/`:

```
inspect -> strip / encode / svg -> decode -> score -> search -> select -> write
```

- `inspect/` reads the format (from magic bytes, never the extension), dimensions, alpha, animation and metadata.
- `strip/` removes metadata losslessly, `encode/` wraps the sharp encoders and `svg/` wraps SVGO. Each produces candidate bytes.
- `metrics/` decodes each candidate and scores it against the decoded source, never against another candidate.
- `search/` finds the lowest passing quality for a format. It is pure, with the encoder and scorer injected.
- `pipeline/` applies the mode rules, picks the smallest passing candidate and writes it through the safe-write path. When no candidate beats the input, it writes the lossless strip instead.

## SSIMULACRA 2 module

- `wasm/` is a Rust crate wrapping the `ssimulacra2` crate. Its build output, `wasm/pkg`, is committed so contributors need no Rust. Only `npm run build:wasm` writes it; never hand-edit it. The Dockerfile pins the base image by digest and wasm-pack, wasm-bindgen and wasm-opt by checksum, and runs wasm-pack with `--mode no-install` so nothing is downloaded unverified. CI rebuilds it on every change under `wasm/` and fails if the output differs.
- The WASM `score(reference, distorted, width, height)` takes 8-bit sRGB RGB pixels with no alpha. It throws on a buffer-length mismatch or images under 8x8. Only `src/metrics/` calls it.
- The generated JS is CommonJS (`wasm/pkg/package.json` sets `"type": "commonjs"`) and compiles the module synchronously on first `require`. `src/metrics/ssimulacra2.ts` is the only loader: it requires the module lazily through `createRequire` on the first score, from `dist/wasm` (which `npm run build` copies from `wasm/pkg`) when compiled, or from `wasm/pkg` when running TypeScript source under the tests. `tests/dist.test.ts` checks the compiled path whenever `dist/` exists, which it always does in CI.
- WASM memory is capped at 4 GiB (wasm32), grows to fit the largest pair scored and never shrinks: about 2 GB for a 12 MP pair and 4 GiB for 26 MP. A 27 MP pair still fits and a 28 MP pair traps. A trap leaves the instance unusable, so the loader discards it and the next score loads a fresh one.
- Scores match libjxl's reference `ssimulacra2` tool within 0.5 (0.104 at most on the pairs in `fixtures/ssimulacra2/`), and a test holds them to it.
- Speed, from `node wasm/bench.mjs` on an i9-10850K with Node 24: one score takes about 1.1 s at 1 MP and 13.3 s at 12 MP (1.9 GiB RSS). libjxl's native tool takes about 0.19 s and 1.8 s. A score runs on one thread and can't be split, and async concurrency alone would queue every score on the main thread, so scoring files in parallel needs `worker_threads`. Each worker keeps its WASM memory, so memory limits the pool size as much as CPU count.

## Metrics

`src/metrics/` is the only code that compares pixels. Every comparison goes through `decodeForScoring`, which applies EXIF orientation and converts to 8-bit sRGB RGBA, so a candidate is always scored against the decoded source.

- Every public function checks that each buffer holds `width * height` RGBA pixels and that the two images share their dimensions, throwing a `RangeError` otherwise.
- `score` is async. It composites images with transparency onto black and onto white, in sRGB like a browser, and returns the lower score. An opaque pair is scored once.
- Identical pixels score 100 without flattening or calling the WASM. Lossless candidates therefore cost almost nothing to score, and they score even when the image is below the 8x8 minimum. A differing pair under 8x8 throws, so callers check `isScorable` first.
- A pair over 26 MP is resized (sharp's default Lanczos 3) to 26 MP at the same aspect ratio and scored at that size, the most the WASM memory holds. That slightly overstates quality, so callers check `isDownscaledForScoring` and warn that the score is approximate. This applies to the CLI and the UI alike.
- `verdictFor` maps a score onto the SSIMULACRA 2 README's bands. Each band includes its lower edge.
- `createDiffMap` amplifies the luma difference 8 times and draws it from red to yellow over the reference, greyscaled and dimmed to half brightness. For images with transparency it also compares the black composites and draws the larger difference.

## Thin entry points

The CLI (`src/bin/`, `src/cli/`) and the UI server (`src/server/`) hold no image logic. They parse input, call the same library functions a programmatic caller would, and render the results.

- Only `src/bin/` reads `process.env` or `process.argv`. Every other module receives its options as arguments.
- No module does work at import time.
- Every module in `src/` lives in its own folder with an `index.ts`. `src/index.ts` is the library entry.
