# Modes and outputs

`optimiseFile` decides what to write for one image: which formats, which encoder settings, and whether writing anything beats keeping the file as it is. This page describes those rules. [encoding.md](./encoding.md) covers the encoders and the quality search, and [svg.md](./svg.md) covers SVG.

## The four modes

| Mode | Writes |
| --- | --- |
| `webp` (default) | A WebP |
| `avif` | An AVIF |
| `same` | The input's own format, re-encoded or with its metadata stripped, whichever is smaller |
| `suite` | An AVIF, a WebP and a JPEG or PNG fallback, for a `<picture>` element |

SVGs are always optimised as SVG, whatever the mode, and get the warning `W_SVG_SAME_ONLY` outside `same`. They are never turned into raster images.

## How an output is chosen

Every raster input is decoded once. Each candidate is encoded from those pixels and scored against them with SSIMULACRA 2, so a candidate is never compared with another candidate.

The candidates for each format are:

| Format | Candidates |
| --- | --- |
| WebP | A lossy quality search. A PNG input also tries lossless WebP and a near-lossless search (levels 20 to 80). A lossless WebP input is re-encoded losslessly only |
| AVIF | A lossy quality search |
| JPEG | A lossy quality search with mozjpeg |
| PNG | Lossless PNG |
| The input's own format | Also the lossless strip: the input with its metadata removed and its image data untouched, which scores 100 |

An image smaller than 8x8 pixels can't be scored, so it only gets lossless candidates and the warning `W_TOO_SMALL_TO_SCORE`. An image over 26 megapixels is scored at 26 MP, so its scores are approximate and it gets `W_SCORED_DOWNSCALED`.

Only candidates smaller than the input count. Of those, the smallest that reaches the target wins.

- **`same`:** the strip and the re-encode compete, so an already well-compressed JPEG usually just loses its metadata. Re-encoding a lossy file compounds its artifacts, but the score is always taken against the decoded input, so the target still holds.
- **`webp` and `avif`:** when no candidate reaches the target, the highest-scoring one that is still smaller is written, with `W_TARGET_NOT_REACHED`. For example, lossy WebP rarely reaches 90 on photos. When nothing in the requested format is smaller than the input (or the format can't hold the image, such as a WebP over 16383 pixels or an AVIF over 16384 on a side), the input's lossless strip is written in its own format instead, with `W_NOT_CONVERTED`.
- **`suite`:** each output must reach the target. The fallback is PNG when any pixel is transparent, and otherwise the smaller of JPEG and PNG. A WebP is kept only if it's smaller than the fallback, and an AVIF only if it's smaller than the WebP, so every `<source>` saves bytes over the one below it. A JPEG or PNG input with nothing smaller to replace it is its own fallback, unchanged, so the `<picture>` always has one.

The result is `kept-original`, with nothing written, only when nothing is smaller and the input has no metadata to strip.

An output that scores below 80 gets `W_NOTICEABLE`, because the loss may be visible side by side.

## Metadata

Every output drops the input's metadata: EXIF, GPS, XMP, IPTC, comments, text chunks and editor data. A re-encode carries none at all, and converts the pixels to sRGB. A strip keeps only what changes how the image displays: the EXIF orientation (as a minimal EXIF block holding nothing else), and a colour profile that isn't sRGB, with the warning `W_ICC_KEPT`. Each output lists what it dropped in `strippedMetadata`.

Re-encoding converts a wide-gamut image, such as a Display P3 photo, to sRGB, and colours outside sRGB are clipped. The score compares against the input converted to sRGB too, so it doesn't see this.

## Where outputs go

An output goes in `outDir`, or next to its input, named after the input with the output format's extension. An output in the input's own format keeps the input's extension when it fits, such as `.jpeg` or `.PNG`.

- **Replacing the input:** an output that would replace its own input, as `same` mode does without `outDir`, fails the file with `E_OUTPUT_IS_INPUT` unless `inPlace` is set. `outDir` avoids it only by pointing somewhere else, so an `outDir` that is the input's own folder still fails, however it is spelt. The one exception is a suite's fallback that is the input unchanged: it is already in place, so it isn't written.
- **Existing files:** when an output already exists, the file is `skipped` with `W_OUTPUT_EXISTS`, unless `overwrite` is set. The outputs the mode aims for (the AVIF and WebP in `suite`) are checked before any work is done, so re-running a batch skips finished files quickly.
- **Safe writes:** each output is written to a temp file in its destination folder, and the files are renamed into place only once every one of them is written. Aborting through the `signal`, or a failed write, leaves no temp files. `dryRun` works everything out and writes nothing.

## Batches

`optimiseBatch` runs many files with the same rules, several at once, each on a worker thread of its own, because scoring blocks the thread it runs on. Each encode itself runs on one thread: libaom splits an AVIF into tiles when given more, which makes it larger at the same quality and makes its bytes depend on the machine's CPU count. So one large image takes longer than it would with every core behind it, but the files come out smaller and the same everywhere. By default it runs one file fewer than the CPU count at once, capped at one per 4 GiB of memory, because scoring a very large image can take that much.

- **Conflicts:** before any work, an input fails with `E_OUTPUT_CONFLICT` when one of its possible outputs could land on another input, or on a path an earlier input's outputs could use. For example, `photo.png` and `photo.jpg` would both write `photo.webp`. Formats come from the first bytes of each file, so a PNG named `photo.jpg` counts as writing `photo.png`. The same file given twice also conflicts. Give such inputs their own output folders: each input can carry an `outDir` of its own.
- **Unexpected errors:** a bug hit by one file fails that file with `E_INTERNAL`, and the rest of the batch carries on.
- **Aborting:** the batch rejects once every file in progress has stopped and removed its temp files. Files that finished before the abort keep their outputs.

[json-contract.md](./json-contract.md) describes the result and the progress events.

## Results

`optimiseFile` resolves to a result whose `status` is `optimised`, `kept-original`, `skipped` or `failed`, with the input's size and, once inspected, its displayed width and height. It rejects only when aborted or given an invalid option. A problem with the file itself is a `failed` result whose `error.code` is one of:

| Code | Meaning |
| --- | --- |
| `E_READ` | The file can't be read |
| `E_UNSUPPORTED_FORMAT` | It isn't a PNG, JPEG, WebP, AVIF or SVG |
| `E_ANIMATED` | It's animated |
| `E_DECODE` | Its header or image data can't be decoded |
| `E_OUTPUT_IS_INPUT` | An output would replace the input without `inPlace` |
| `E_WRITE` | An output can't be written |

Each output reports its role, path, format, method (`strip`, `svgo`, `lossy`, `lossless` or `near-lossless`), quality, size, saving, score, verdict and the metadata it dropped. SVG outputs also report their gzipped size.
