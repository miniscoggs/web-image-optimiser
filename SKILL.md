---
name: web-image-optimiser
description: Optimises images for websites with the `wio` CLI. It strips metadata and writes the smallest WebP, AVIF, JPEG, PNG or SVG that stays above a perceptual quality target (SSIMULACRA 2), with <picture> markup on request. Use it to optimise, compress, shrink or convert images for the web, or to check how much quality an optimised image lost.
---

# web-image-optimiser (`wio`)

`wio` reads PNG, JPEG, WebP, AVIF and SVG files, always strips their metadata, and writes the smallest output that still scores above the quality target. It never prompts. If `wio` isn't on the PATH, `npx web-image-optimiser` runs the same CLI.

## Choosing `--to`

| Mode | Use it when |
| --- | --- |
| `webp` (default) | One modern file per image is enough. Every current browser shows WebP |
| `avif` | The smallest files matter more than time: AVIF encodes are slow |
| `suite` | The images go on web pages: AVIF, WebP and a JPEG or PNG fallback for `<picture>`, each kept only when smaller than the next. Add `--markup` |
| `same` | Files must keep their format, eg assets referenced by name. Needs `--out-dir` or `--in-place` |

SVGs always stay SVG. An output that would replace its input (an SVG, or `same` mode, without `--out-dir`) fails with `E_OUTPUT_IS_INPUT` unless `--in-place` is given.

`--target` is the lowest quality allowed: `high` (80, the default: not noticeable side by side), `excellent` (85), `visually-lossless` (90), `web` (70), or a number. Don't lower it unless asked.

## Commands

```sh
wio ./images --to webp --json
wio ./images --recursive --out-dir web --dry-run --json
wio ./images --to suite --out-dir web/ --markup --json
wio compare images/photo.jpg images/photo.webp --json
```

1. Writes a WebP beside each image in `images/`.
2. On a big batch, run with `--dry-run` first: it reports what would be written and writes nothing. Check the result, then run the same command without `--dry-run`.
3. For web pages: writes the `<picture>` set of each image into `web/`, and adds each file's `markup`.
4. Scores an optimised image against its original.

A folder gives the images at its top level; `--recursive` adds its subfolders, which `--out-dir` mirrors. Quote glob patterns: `"src/**/*.png"`. A folder scan leaves out the files this mode writes, so a re-run doesn't treat its own outputs as inputs.

Scoring takes about a second per megapixel, and each format's search scores several times, so a 12 MP photo can take minutes, most of all in `avif` and `suite`. `--ndjson` prints one event per line as files finish.

## Reading the result

With `--json`, stdout holds exactly one `RunResult` (its JSON Schema ships as `web-image-optimiser/schema/run-result.schema.json`). Everything else goes to stderr.

```json
{
  "files": [{
    "input": "images/photo.jpg", "status": "optimised", "bytes": 250000, "width": 1600, "height": 1067,
    "outputs": [{ "role": "webp", "path": "images/photo.webp", "format": "webp", "method": "lossy",
                  "quality": 74, "bytes": 61000, "saving": 0.756, "score": 81.2, "verdict": "very-high" }],
    "warnings": []
  }],
  "totals": { "files": 1, "optimised": 1, "keptOriginal": 0, "skipped": 0, "failed": 0,
              "inputBytes": 250000, "outputBytes": 61000, "saving": 0.756 }
}
```

- `status` is `optimised`, `kept-original` (nothing was smaller and there was no metadata to strip, so nothing was written), `skipped` (an output already exists) or `failed` (see `error.code`).
- Branch on `code`, never on `message`.
- Report `totals.saving`, and any output whose `verdict` is `noticeable` or `obvious`.

| Code | What to do |
| --- | --- |
| `E_OUTPUT_IS_INPUT` | Add `--out-dir <dir>`, or `--in-place` when replacing the originals was asked for |
| `W_OUTPUT_EXISTS` | The file was done before. Add `--overwrite` only to redo it |
| `E_OUTPUT_CONFLICT` | Two inputs would write the same file, eg `a.png` and `a.jpg`. Give them separate `--out-dir`s |
| `W_NOT_CONVERTED` | Nothing in the asked format was smaller, so the file was stripped in its own format |
| `W_TARGET_NOT_REACHED`, `W_NOTICEABLE` | The file written is below the target, or below 80. Mention it |
| `E_ANIMATED`, `E_UNSUPPORTED_FORMAT`, `E_DECODE` | `wio` can't optimise this file. Leave it alone |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No file failed. Skipped and kept-original files are fine |
| 1 | At least one file failed; the others still ran |
| 2 | Usage error: an unknown flag, `--markup` without `--to suite`, or no images found (`E_NO_INPUTS`) |

## Safety

- No output is ever larger than its input.
- An input is only replaced with `--in-place`, and another existing file only with `--overwrite`. Add them only when the task needs it.
- `--dry-run` writes nothing.
- Metadata (EXIF, GPS, XMP, comments) is always stripped. Only the orientation and a colour profile that isn't sRGB survive.
- `--markup` writes `alt="TODO: describe image"`. Replace it with a description from the page's context, or ask; never ship the placeholder.
