# JSON contract

`optimiseBatch` resolves to a `RunResult`, and reports progress as events. The CLI will print the same shapes: one `RunResult` with `--json`, and one event per line with `--ndjson`. Agents and scripts can rely on this contract. It is the zod schemas in `src/schema/contract.ts`, and the build writes it as JSON Schema (draft 2020-12) to:

- `dist/schema/run-result.schema.json`
- `dist/schema/event.schema.json`

The package exports both as `web-image-optimiser/schema/run-result.schema.json` and `web-image-optimiser/schema/event.schema.json`.

## Versioning

`schemaVersion` is `1`.

- **Adding a field** is a minor change and keeps `schemaVersion`. The JSON Schema leaves every object open, so a validator built from today's schema accepts tomorrow's results. Ignore fields you don't know.
- **Renaming or removing a field, or changing what it means,** bumps `schemaVersion` and is recorded below.
- **Codes** (`E_*` and `W_*`) are never renamed, removed or reused once released. New ones may be added, so treat an unknown code as a generic error or warning.
- **Messages** are for people and may change between releases. Branch on codes, never on messages.

## RunResult

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `tool` | `version` (web-image-optimiser's), `sharp` and `libvips`. Encoded bytes vary between versions, so record these alongside any sizes you compare |
| `options` | The options used, with defaults filled in: `to`, `target` (a preset resolved to its score), `outDir` (when given), `inPlace`, `overwrite`, `dryRun` and `concurrency` |
| `files` | One `FileResult` per input, in input order |
| `totals` | See below |

`totals` counts `files` and how many ended `optimised`, `keptOriginal`, `skipped` and `failed`. `inputBytes` is the total size of the optimised and kept-original inputs. `outputBytes` is the same files afterwards, counting each optimised file's smallest output (in `suite` mode, what a current browser downloads) and each kept file as it was. `saving` is the fraction of `inputBytes` saved.

## FileResult

| Field | Meaning |
| --- | --- |
| `input` | The input path, as given |
| `status` | `optimised` (at least one output was written, or would be in a dry run), `kept-original` (nothing was smaller and there was no metadata to strip), `skipped` (an output already exists) or `failed` |
| `bytes` | The input's size, once it has been read |
| `outputs` | What was written, AVIF first and the fallback last. Empty unless `optimised` |
| `warnings` | `{ code, message }` for each warning |
| `error` | `{ code, message }`, only when `failed` |

Each output has:

| Field | Meaning |
| --- | --- |
| `role` | `same` (the input's own format), `webp`, `avif`, or `fallback` (a suite's JPEG or PNG) |
| `path` | Where it was written |
| `format` | `png`, `jpeg`, `webp`, `avif` or `svg` |
| `method` | `strip` (the input with its metadata removed and its image data untouched), `svgo`, `lossy`, `lossless` or `near-lossless` |
| `quality` | The encoder quality, or near-lossless level, when the method takes one |
| `bytes` | Its size |
| `gzipBytes` | SVG only: its size gzipped, as a server usually sends it |
| `saving` | The fraction of the input's size saved: 0 for a suite's unchanged fallback |
| `score` | Its SSIMULACRA 2 score against the input; 100 for identical pixels |
| `verdict` | `visually-lossless` (90+), `excellent` (85+), `very-high` (80+), `high` (70+), `noticeable` (50+) or `obvious` |
| `strippedMetadata` | The kinds of metadata the input had that this output doesn't: `comment`, `editor`, `exif`, `gps`, `icc`, `iptc`, `other`, `text` or `xmp` |

[modes.md](./modes.md) explains how outputs are chosen.

## Events

Each event has a `type`:

| Type | Fields |
| --- | --- |
| `run-start` | `schemaVersion`, `tool`, `options`, and `files`, how many files the run has |
| `file-start` | `index` (the file's position in the run, from 0) and `input` |
| `file-done` | `index` and `file`, its `FileResult` |
| `run-done` | `totals` |

A run emits `run-start` first and `run-done` last, and each file's `file-start` comes before its `file-done`. Files run in parallel, so events for different files interleave; use `index` to match them. An aborted run emits no `run-done`.

## Codes

| Error | Meaning |
| --- | --- |
| `E_ANIMATED` | The image is animated |
| `E_DECODE` | The file looks like a supported format but can't be decoded |
| `E_INTERNAL` | An unexpected error, which is a bug. The rest of the run carries on |
| `E_OUTPUT_CONFLICT` | One of the file's outputs could land on another input, or on an earlier input's outputs, such as `photo.png` and `photo.jpg` both writing `photo.webp` |
| `E_OUTPUT_IS_INPUT` | An output would replace the input without in-place writes allowed |
| `E_READ` | The file can't be read |
| `E_TOO_LARGE_FOR_FORMAT` | The image is too large for a format. Other formats are still tried, so this doesn't fail a file on its own |
| `E_UNSUPPORTED_FORMAT` | The file isn't a PNG, JPEG, WebP, AVIF or SVG |
| `E_WRITE` | An output can't be written |

| Warning | Meaning |
| --- | --- |
| `W_ICC_KEPT` | A colour profile that isn't sRGB was kept, because removing it would shift the colours |
| `W_NOTICEABLE` | An output scores below 80, so the loss may be visible side by side |
| `W_NOT_CONVERTED` | Nothing in the requested format was smaller, so the file stays in its own format, stripped or kept |
| `W_OUTPUT_EXISTS` | An output already exists, so the file was skipped |
| `W_SCORED_DOWNSCALED` | The image is over 26 megapixels, so it was scored at 26 MP and its scores are approximate |
| `W_SVG_SAME_ONLY` | SVGs are always optimised as SVG |
| `W_TARGET_NOT_REACHED` | No output in the requested format reached the target, so the highest-scoring one that is smaller was written |
| `W_TOO_SMALL_TO_SCORE` | The image is under 8x8 pixels, so only lossless outputs were tried |

## Changes

None yet: this is version 1.
