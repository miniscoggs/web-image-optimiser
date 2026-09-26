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

A stage that rejects a file throws `OptimiserError` (`src/schema/`) with a code from `src/schema/codes.ts`. `optimiseFile` turns it into a `failed` result, so only an abort, an invalid option or a bug rejects.

## Inspection

`inspect` reads only the header through sharp's `metadata()`, and parses the few things sharp can't see.

- The format comes from the leading bytes: the PNG or JPEG signature, `RIFF....WEBP`, an `ftyp` box with an `avif` or `avis` brand, or XML whose root element is `<svg>`. Anything else fails with `E_UNSUPPORTED_FORMAT`.
- Animation fails with `E_ANIMATED`: more than one page in sharp, an `acTL` chunk before a PNG's image data, or an `avis` brand. The last two are checked before sharp reads the file, because libvips decodes only an APNG's default image and libheif can reject an AVIF sequence outright.
- `E_DECODE` means sharp or SVGO couldn't read the header. Damaged image data only shows up when a later stage decodes it.
- `exif`, `xmp`, `iptc` and PNG `text` come from sharp. `gps` is a GPS pointer in EXIF IFD0. `comment` is a JPEG `COM` segment before `SOS`, or an SVG comment other than a `<!--! -->` licence notice, which SVGO's `removeComments` keeps. `editor` is an SVG namespace on SVGO's `editorNamespaces` list, or a `<metadata>` element, which is what SVGO's `removeEditorsNSData` and `removeMetadata` plugins remove.
- An ICC profile is sRGB only when its description is exactly `sRGB`, `sRGB IEC61966-2.1` or `sRGB IEC61966-2-1 black scaled`. Any other profile counts as non-sRGB and is kept, because dropping a profile that isn't sRGB shifts colours.
- SVGs are parsed by SVGO, whose tree a plugin that changes nothing captures. `referencedIds` lists the defined IDs used through `href`, `url(#id)`, `aria-labelledby`, `aria-describedby` or a CSS `#id` selector.

## Lossless strip

`stripLossless` edits a JPEG, PNG, WebP or AVIF file's segments, chunks or boxes and never touches the pixel data, so a strip decodes to the same pixels and scores 100. It keeps an allowlist and drops everything else, including unknown segments and chunks.

- **JPEG** keeps `APP0` JFIF, `APP14` Adobe, a non-sRGB `APP2` ICC profile (joined across segments before it is classified), the other non-APPn segments, and everything from the first `SOS` to `EOI`. It drops the rest, including bytes after `EOI`, such as an appended motion-photo video.
- **PNG** keeps critical chunks, the display chunks `tRNS`, `gAMA`, `cHRM`, `sRGB`, `cICP`, `mDCV` and `cLLI`, and a non-sRGB `iCCP`, copying them with their CRCs untouched. A text chunk with the keyword `XML:com.adobe.xmp` counts as `xmp`.
- **WebP** keeps `VP8X`, `VP8 `, `VP8L`, `ALPH` and a non-sRGB `ICCP`, then rewrites the `VP8X` ICC, EXIF and XMP flags and the RIFF size.
- **AVIF** removes the `Exif` and `mime` items (from `iinf`, `iloc`, `iref` and `ipma`, and their data from `mdat` or `idat`) and any `colr` property with an sRGB ICC profile, renumbering the `ipma` indices after it. Other properties, including `irot`, `imir` and `nclx` colour, are kept. `meta` is rebuilt twice: once to measure how much it shrinks, then with every kept item's `iloc` offsets moved by that shrink and by the bytes cut before its data. Field sizes never change, and offsets only get smaller, so they always fit. The generic box and field helpers are in `src/strip/isobmff.ts`.
- When the orientation isn't 1, the first EXIF block is replaced by a 26-byte TIFF holding only Orientation, with the block's original `Exif\0\0` header when it had one. An EXIF block no longer than that already holds nothing else and is kept as it is. This makes a second strip remove nothing and stops the replacement making a file larger.
- `removed` lists the kinds dropped: the `inspect` metadata kinds (with `gps` when the dropped EXIF had it), `icc`, and `other` for anything else, such as PNG `pHYs`. When it is empty, the input is returned as it is.
- A file whose structure ends early (no `SOS`, no `IEND`, a chunk past the RIFF payload, a truncated AVIF box or item table, or any field read past the end, which `stripLossless` maps from a `RangeError`) fails with `E_DECODE`.

## SVG

`src/svg/` never rasterises an SVG. `docs/svg.md` is the user-facing account and lists what the render check can't see.

- `optimiseSvg` runs SVGO's `preset-default` with `multipass`, overriding `cleanupIds`, `inlineStyles` (it deletes the IDs and classes whose rules it inlines) and `removeDesc` to off, and `removeUnknownsAndDefaults` to `keepRoleAttr: true`. SVGO 4's preset already leaves `viewBox` and `<title>` alone. Recheck the preset's contents whenever SVGO is bumped.
- It tries `floatPrecision` 2, 3, 4 and 5, and returns the first whose renders score at least 90 (`SVG_TARGET`, whatever the raster target) at 1x and 2x. The scale is raised so the short side is at least 64 px, and capped at the scorer's 26 MP. Renders come from `decodeForScoring(bytes, { density })`, where 72 DPI is one pixel per SVG unit. A candidate that fails to render, or renders at a different size, fails.
- When no precision passes, it returns `stripSvg`'s output with `method: "strip"` and a score of 100. `stripSvg` runs only `removeComments`, `removeMetadata` and `removeEditorsNSData`, reports `comment` and `editor` from `inspectSvg`, and returns the input itself when there is nothing to remove.
- `gzipBytes` is `gzipSync` at level 9.

## Encoding and search

- The encoders in `src/encode/` take the source decoded by `decodeForScoring` (8-bit sRGB RGBA, orientation applied), never the file. The source is decoded once, and every candidate starts from the pixels it is scored against. A 16-bit source therefore reaches `pngLossless` as 8-bit, which the score confirms is invisible.
- `createPipeline` drops an alpha channel whose pixels are all opaque, so AVIF, WebP and PNG don't store one. Outputs carry no metadata and no ICC profile, since the pixels are already sRGB.
- The settings are hard-coded, with no user-facing effort flags: WebP effort 6, `smartSubsample`, `alphaQuality: 100`; JPEG uses mozjpeg's defaults; PNG uses compression level 9 with adaptive filtering. AVIF effort 6 with `tune: iq` and WebP `smartDeblock` come from `node scripts/bench-encoders.mjs`, and `docs/encoding.md` records the numbers. Re-run the benchmark after bumping sharp.
- `optimiseFile` sets `sharp.concurrency(1)` for the process. With more threads, libaom splits an AVIF into tiles, which made AVIFs 2 to 35% larger at the same target (9% on a photo) and made their bytes depend on the CPU count. WebP, JPEG and PNG don't change with threads. Batches get their parallelism from worker threads instead, and the benchmark pins the same setting.
- `assertFitsFormat` refuses a side over 16383 px for WebP, 16384 for AVIF (sharp's HEIF limit) and 65500 for JPEG (libjpeg's) with `E_TOO_LARGE_FOR_FORMAT`, so the pipeline can drop that format's candidates and keep the others.
- `QUALITY_RANGES` holds the qualities searched per lossy encoder: WebP 30–95, AVIF 20–90, JPEG 40–95.
- `searchQuality` is pure; the encoder and scorer are passed in. It tries the highest quality first and stops if that fails. Otherwise it binary-searches for the lowest passing integer quality, then tries one step above it, because encoders aren't strictly monotonic. Each quality is encoded once. The chosen attempt is the smallest passing one, or the highest-scoring one when none passes (`reached: false`).

## Pipeline

`optimiseFile` in `src/pipeline/` is the per-file entry point. `docs/modes.md` is the user-facing account of its rules.

- **Order:** read (`E_READ`), `inspect`, check the mode's primary output paths, decode and strip the source once, choose, check every chosen path, then write. The primary paths are the requested formats' (AVIF and WebP in `suite`), so a re-run skips finished files before any encoding. The strip fallback's and a suite fallback's paths are only known once chosen.
- **Candidates** (`rasterCandidates.ts`) are made per format: the strip when the source is already in that format, plus that format's re-encodes, which run concurrently so sharp encodes in the background while the main thread scores. A tiny image gets lossless encoders only. A PNG source adds lossless WebP and a near-lossless search over levels 20 to 80 (libwebp only tells levels 20 apart). A lossless WebP source stays lossless. `E_TOO_LARGE_FOR_FORMAT` empties that format's list instead of failing the file.
- **Selection** (`selectRaster.ts`) keeps candidates smaller than a bound and picks the smallest that reaches the target. Only `webp` and `avif` modes converting to another format may fall back to the highest-scoring candidate below the target (`W_TARGET_NOT_REACHED`). `suite` searches every format at once, then applies the chain fallback, WebP, AVIF, each bound by the size of the one kept before it. The fallback's bound is the input's size plus one, so a JPEG or PNG input with nothing to strip is its own fallback, unchanged, and a page always has one.
- **Kept-original** is any selection whose outputs are all byte-identical to the input, including none.
- **Destinations** (`destination.ts`): an output is named after the input, keeping the input's extension when it fits the format. A path is the input when its device and inode match, which sees through case, links and `..`; where the file system reports no inode, the resolved paths are compared, case-insensitively on Windows and macOS. An unchanged output at the input's own path is neither written nor a clash.
- **Writes** (`writeOutputs.ts`) go to `.<name>.wio-<hex>.tmp` in the destination folder, and are renamed only once all of a file's outputs are written. Temp files are removed in `finally`, and any failure except an abort becomes `E_WRITE`.

## CI

`.github/workflows/ci.yml` runs on pull requests, pushes to `main` and manual runs. `scripts/ci-scope.mjs` decides what each run needs:

- **Every run** lints, builds and runs `npm run test:fast` on Ubuntu, Windows, macOS arm64 and macOS Intel with Node 24, and on Ubuntu with Node 26.
- **A pull request that changes engine files** (`src/`, `wasm/`, `fixtures/`, `tests/golden/`, `package.json` or the lockfile) also runs `npm run test:golden` on Ubuntu.
- **A release pull request**, one that changes the version in `package.json`, runs the golden tests on every OS, and `scripts/check-release.mjs` checks that the version is higher than the base branch's, the lockfile matches it, and `CHANGELOG.md` has a `## <version>` heading.
- **A manual run** (`gh workflow run ci.yml --ref <branch>`) runs the golden tests on every OS, for an engine change that needs checking on every platform before its release.
- **A push to `main`** runs only the fast checks, because its pull request already ran the rest.
- **"CI passed"** needs every other job, and passes when each one passed or wasn't needed. It's the one check to require: a skipped job counts as passing for a required check, so the individual jobs must not be required.

## Golden tests

`tests/golden/` is the engine contract. `goldenMatrix.ts` runs every fixture through every mode with `optimiseFile`, checks every rule the pipeline promises (sizes, metadata, dimensions, alpha, warnings, the suite chain, the JSON contract, a recomputed score), and compares each result with `golden.json`: status, error and warning codes, roles, formats and methods exactly, quality within 3, size within 10%.

- Each mode is split into four shard files, `<mode>.<n>.test.ts`, with the fixtures sorted largest first and dealt out in turn, so each shard gets one photo and Vitest runs them in parallel.
- `node scripts/update-golden.mjs` regenerates `golden.json` from the built package, running `optimiseBatch` on worker threads in a dry run. The tests never write it. Changing it is an API change; the `update-image-engine` skill covers the process.
- With threads pinned, every golden result was byte-identical on Windows x64 and Linux x64, and on a subset of nine fixtures in every mode under emulated Linux arm64. Before pinning, only AVIF differed, because of the thread count. macOS hasn't been compared directly; CI runs the golden tests there, and the tolerances allow for small platform differences.

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

## Batches

`optimiseBatch` runs files in lanes, as many as `concurrency`, each taking the next file from a shared queue.

- **Workers:** each lane owns one worker thread (`worker.ts`), because scoring blocks its thread. The TypeScript sources run lanes on the calling thread instead, since a worker can't load `.ts` files through their `.js` imports, so the tests cover the worker path through the built package in `tests/dist.test.ts`. `runFile` (`executors.ts`) is shared by both, and turns a non-`OptimiserError` rejection into an `E_INTERNAL` result. A worker that crashes fails its file with `E_INTERNAL` and is replaced.
- **Concurrency** defaults to one fewer than `availableParallelism()`, capped at one per 4 GiB of `totalmem()`, a worker's WASM ceiling.
- **Conflicts:** before any work, the batch reads each input's first 16 KB in turn, one file at a time, and detects its format. `outputClaims` (in `destination.ts`) lists every path its outputs could take, named by `outputPath` itself: the requested formats, a suite's JPEG and PNG fallbacks, and the input's own format. An input fails with `E_OUTPUT_CONFLICT` when a claim is another input's path, or already claimed by an earlier input, or when it repeats an earlier input. An unreadable or unsupported file claims nothing and fails in its own turn.
- **Aborting:** one `AbortController` links the caller's signal and any lane's failure, such as `onEvent` throwing. The batch waits for every lane with `Promise.allSettled`, so it only rejects once every file in progress has cleaned up, and each lane's `finally` terminates its worker. An aborted batch emits no `run-done`.

## JSON contract

`src/schema/contract.ts` holds the zod schemas for `RunResult`, `FileResult` and the events, and `src/pipeline/types.ts` derives the public types from them with `z.infer`. zod takes about 60 ms to import, so no runtime module imports `contract.ts`; only the build, the tests and the UI server do. `scripts/build-schema.mjs` writes `dist/schema/*.schema.json` with `z.toJSONSchema(schema, { io: "input" })`, which leaves objects open so consumers accept added fields. Tests check a result with `expect(schema.parse(result)).toEqual(result)`, since parsing strips any field the schema lacks. Enums the contract shares with other modules are `as const` tuples there, such as `INSPECT_FORMATS`, `METRICS_VERDICTS`, `STRIP_REMOVED_KINDS` and `ENCODE_METHODS`.

## Thin entry points

The CLI (`src/bin/`, `src/cli/`) and the UI server (`src/server/`) hold no image logic. They parse input, call the same library functions a programmatic caller would, and render the results.

- Only `src/bin/` reads `process.env` or `process.argv`. Every other module receives its options as arguments.
- No module does work at import time, except the entry points: `src/bin/` and the batch worker, `src/pipeline/worker.ts`, which nothing imports.
- SVGO takes about 250 ms to import, so it is loaded with `await import("svgo")` when the first SVG needs it, and only imported statically as types. The WASM scorer loads lazily for the same reason.
- Every module in `src/` lives in its own folder with an `index.ts`. `src/index.ts` is the library entry.
