---
name: web-image-optimiser
description: Optimises images for websites with the `wio` CLI. It strips metadata, keeping copyright and licence fields, and writes the smallest WebP, AVIF, JPEG, PNG or SVG that stays above a perceptual quality target (SSIMULACRA 2). Use it to optimise, compress, shrink or convert images for the web, or to check how much quality an optimised image lost.
---

# web-image-optimiser (`wio`)

`wio` reads PNG, JPEG, WebP, AVIF and SVG files, strips their metadata apart from the copyright, licence and AI-origin fields Google Images reads, and writes the smallest output that still scores above the quality target. It never prompts. If `wio` isn't on the PATH, ask where it's installed. Never install `wio` or `web-image-optimiser` from npm: this tool isn't published there, so a package with either name is someone else's.

## Choosing `--to`

| Mode | Use it when |
| --- | --- |
| `webp` (default) | One modern file per image is enough. Every current browser shows WebP |
| `avif` | The smallest files matter more than time: AVIF encodes are slow |
| `suite` | The images go on web pages: AVIF, WebP and a JPEG or PNG fallback for `<picture>`, each kept only when smaller than the next. Add `--out-dir` |
| `same` | Files must keep their format, eg assets referenced by name. Needs `--out-dir` or `--in-place` |

SVGs always stay SVG. Without `--out-dir`, an output that would replace its input fails with `E_OUTPUT_IS_INPUT` unless `--in-place` is given. That happens to every file in `same` mode, every SVG, a file already in the format asked for (a WebP in `webp` mode, an AVIF in `avif`, either in `suite`), most JPEGs and PNGs in `suite`, and a file nothing in the asked format beats (`W_NOT_CONVERTED`). So pass `--out-dir` unless replacing the originals was asked for.

`--target` is the lowest quality allowed: `high` (80, the default: not noticeable side by side), `excellent` (85), `visually-lossless` (90), `web` (70), or a number. Don't lower it unless asked.

`--max-width <px>` shrinks wider images to that width before encoding, keeping their aspect ratio; narrower images and SVGs keep their size. Use it for camera-sized photos, at twice the widest CSS width the image is shown at, eg `--max-width 1600` for one shown at most 800 px wide. Each output reports its own `width` and `height`, and `wio compare` can't score a shrunk output against its original, since it needs images of one size.

Every raster output keeps the image's copyright and licence fields, and its Digital Source Type, which marks AI-generated images. `--creator <name>`, `--credit <text>`, `--copyright <text>`, `--rights-url <url>` (the licence's URL) and `--licensor-url <url>` (where to license the image) add a field only where a file has none. Pass them only with values the user gave. `--strip-all` removes every field, credits included: use it when the images' credits mustn't be published. It can't be combined with the other five.

## Commands

```sh
wio ./images --to webp --out-dir optimised --json
wio ./images --recursive --out-dir web --dry-run --json
wio ./images --to suite --out-dir web/ --json
wio compare images/photo.jpg optimised/photo.webp --json
```

1. Writes a WebP of each image in `images/` into `optimised/`.
2. On a big batch, run with `--dry-run` first: it reports what would be written and writes nothing. Check the result, then run the same command without `--dry-run`.
3. For web pages: writes the `<picture>` set of each image into `web/`. Each file's `outputs` lists the ones kept.
4. Scores an optimised image against its original.

A folder gives the images at its top level; `--recursive` adds its subfolders, which `--out-dir` mirrors. Quote glob patterns: `"src/**/*.png"`. A folder scan leaves out the files this mode writes, so a re-run doesn't treat its own outputs as inputs.

Scoring takes about a second per megapixel, and each format's search scores several times, so a 12 MP photo can take minutes, most of all in `avif` and `suite`. `--ndjson` prints one event per line as files finish.

## Reading the result

With `--json`, stdout holds exactly one `RunResult`. Everything else goes to stderr.

```json
{
  "files": [{
    "input": "images/photo.jpg", "status": "optimised", "bytes": 250000, "width": 1600, "height": 1067,
    "outputs": [{ "role": "webp", "path": "optimised/photo.webp", "format": "webp", "width": 1600,
                  "height": 1067, "method": "lossy", "quality": 74, "bytes": 61000, "saving": 0.756,
                  "score": 81.2, "verdict": "very-high" }],
    "warnings": []
  }],
  "totals": { "files": 1, "optimised": 1, "keptOriginal": 0, "skipped": 0, "failed": 0,
              "inputBytes": 250000, "outputBytes": 61000, "saving": 0.756 }
}
```

- `status` is `optimised`, `kept-original` (nothing was smaller and there was no metadata to strip besides the rights fields, so nothing was written), `skipped` (an output already exists) or `failed` (see `error.code`).
- Branch on `code`, never on `message`.
- Report `totals.saving`, and any output whose `verdict` is `noticeable` or `obvious`.

| Code | What to do |
| --- | --- |
| `E_OUTPUT_IS_INPUT` | Add `--out-dir <dir>`, or `--in-place` when replacing the originals was asked for |
| `W_OUTPUT_EXISTS` | The file was done before. Add `--overwrite` only to redo it |
| `E_OUTPUT_CONFLICT` | Two inputs would write the same file, eg `a.png` and `a.jpg`. Give them separate `--out-dir`s |
| `W_NOT_CONVERTED` | Nothing in the asked format was smaller, so the file was stripped in its own format, or with `--max-width` re-encoded in it |
| `W_NOT_RESIZED` | Nothing at `--max-width` was smaller than the file, so it was kept as it is. There's nothing to retry |
| `W_NO_RIGHTS` | The file has no copyright or licence fields. Ask the user for the values to add with the flags above, or whether to pass `--strip-all`. Never invent a creator, copyright or URL |
| `W_RIGHTS_NOT_ADDED` | The file is already smaller than any output carrying the fields named, so they were left out. There's nothing to retry: tell the user |
| `W_TARGET_NOT_REACHED`, `W_NOTICEABLE` | The file written is below the target, or below 80. Mention it |
| `E_ANIMATED`, `E_UNSUPPORTED_FORMAT`, `E_DECODE` | `wio` can't optimise this file. Leave it alone |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No file failed. Skipped and kept-original files are fine |
| 1 | At least one file failed; the others still ran |
| 2 | Usage error: an unknown flag, `--strip-all` with a rights flag, or no images found (`E_NO_INPUTS`) |
| 141 | The run stopped because its output was closed early, as `--ndjson \| head` does. Read the whole output instead |

## Safety

- No output is ever larger than its input.
- An input is only replaced with `--in-place`, and another existing file only with `--overwrite`. Add them only when the task needs it.
- `--dry-run` writes nothing.
- Metadata (EXIF, GPS, XMP, comments) is always stripped. Only the rights fields (Creator, Credit Line, Copyright Notice, Web Statement of Rights, Licensor URL and Digital Source Type, rewritten as XMP, and removed too with `--strip-all`), the orientation and a colour profile that isn't sRGB survive. An output lists its fields in `rights`.