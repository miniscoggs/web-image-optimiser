# Modes and outputs

`wio` decides what to write for each image: which formats, which encoder settings, and whether writing anything beats keeping the file as it is. This page describes those rules. [encoding.md](./encoding.md) covers the encoders and the quality search, and [svg.md](./svg.md) covers SVG.

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
| PNG | Lossless PNG, and a palette search: at most 256 colours, as few as the quality allows. A photo fails it at the top quality, which ends its search there |
| The input's own format | Also the lossless strip: the input with its metadata removed and its image data untouched, which scores 100. A resized image has none ([Max width](#max-width)) |

An image smaller than 8x8 pixels can't be scored, so it only gets lossless candidates and the warning `W_TOO_SMALL_TO_SCORE`. An image over 26 megapixels is scored at 26 MP, so its scores are approximate and it gets `W_SCORED_DOWNSCALED`.

Only candidates smaller than the input count, measured with the rights they carry ([Metadata](#metadata)). Of those, the smallest that reaches the target wins.

- **`same`:** the strip and the re-encode compete, so an already well-compressed JPEG usually just loses its metadata. Re-encoding a lossy file compounds its artifacts, but the score is always taken against the decoded input, so the target still holds.
- **`webp` and `avif`:** when no candidate reaches the target, the highest-scoring one that is still smaller is written, with `W_TARGET_NOT_REACHED`. For example, lossy WebP rarely reaches 90 on photos. When nothing in the requested format is smaller than the input (or the format can't hold the image, such as a WebP over 16383 pixels or an AVIF over 16384 on a side), the input's lossless strip is written in its own format instead, with `W_NOT_CONVERTED`.
- **`suite`:** each output must reach the target. The fallback is PNG when any pixel is transparent, and otherwise the smaller of JPEG and PNG. A WebP is kept only if it's smaller than the fallback, and an AVIF only if it's smaller than the WebP, so every `<source>` saves bytes over the one below it. A JPEG or PNG input with nothing smaller to replace it is its own fallback, unchanged, so the `<picture>` always has one.

The result is `kept-original`, with nothing written, only when nothing is smaller and the input has no metadata to strip besides its rights, or, for a resized image, when nothing at the new width is smaller.

An output that scores below 70 gets `W_NOTICEABLE`, because the loss is likely to be noticeable. At the default target, `web` (70), that happens only to a conversion that couldn't reach it.

## Max width

With `--max-width <px>`, a raster image wider than the cap is shrunk to exactly that width before anything is encoded, keeping its aspect ratio, with the height rounded to the nearest pixel. The width is the one displayed, after EXIF orientation, so a portrait photo stored on its side is capped by its width as it appears. The resize uses sharp's default Lanczos 3 filter, which weights colours by their opacity so transparent pixels don't bleed into their neighbours. Narrower images and SVGs keep their size, and nothing is enlarged.

Every candidate is encoded from the shrunk pixels and scored against them, so a score measures the encoding, not the resize: the detail a resize removes doesn't lower it. The 8x8 minimum and the 26-megapixel limit apply to the shrunk image.

A lossless strip keeps the input's size, so a resized image has no strip candidate:

- **`webp` and `avif`:** when nothing in the requested format is smaller than the input, the fallback is the smallest re-encode in the input's own format at the new width that reaches the target, with `W_NOT_CONVERTED`.
- **`suite`:** a JPEG or PNG input can't be its own unchanged fallback.
- **Nothing smaller:** when nothing at the new width is smaller than the input and reaches the target, which takes an input that is already tiny for its size, the file is `kept-original` with `W_NOT_RESIZED`.

Each output reports its own `width` and `height`, while the file's result keeps the input's.

## Metadata

Every output drops the input's metadata: EXIF, GPS, XMP, IPTC, comments, text chunks and editor data. It keeps only two things:

- **Rights:** the fields Google Images reads for credits, its Licensable badge and its label for AI-generated images: Creator, Credit Line, Copyright Notice, Web Statement of Rights, Licensor URL and Digital Source Type. Each is read from the first place the input has it: its XMP, then its IPTC, then EXIF's Artist and Copyright, then PNG's Author and Copyright text. Every raster output carries them as one compact XMP packet, whatever its format, so rights from PNG text or EXIF, which Google doesn't read, become visible to it. An output lists them in `rights`.
- **Display:** a strip keeps what changes how the image displays: the EXIF orientation (as a minimal EXIF block holding nothing else), and a colour profile that isn't sRGB, with the warning `W_ICC_KEPT`. A re-encode carries neither, and converts the pixels to sRGB.

Each output lists the kinds of metadata the input had in `strippedMetadata`, since each was dropped or rewritten, so `xmp` there can sit beside the rights it keeps. SVGs keep no rights: SVGO removes `<metadata>`, and Google reads none from an SVG.

`--strip-all` (`stripAll`) removes the rights too. `--creator`, `--credit`, `--copyright`, `--rights-url` and `--licensor-url` (`rights`) add fields where a file has none, and never replace one it has, so a batch from several photographers keeps each one's credit. An output lists the fields it added in `rightsAdded`.

The rights count in every size comparison, so no output is larger than its input because of them:

- **Added fields** are only carried when something carrying them is smaller than the input. Otherwise the file follows the usual rules without them, which often means `kept-original`, and gets `W_RIGHTS_NOT_ADDED` naming them. In `suite` this is decided for each output, so an unchanged fallback lacks them while the AVIF and WebP carry them.
- **The input's own fields** can be too large as well: in a small file whose rights sit in IPTC, EXIF or PNG text, the XMP packet they move into can outweigh everything the strip removes. Then they're dropped too, with `W_RIGHTS_NOT_ADDED`, so the rest of the metadata, GPS included, still goes. An input that holds nothing but its rights, such as a file `wio` wrote, never loses them: when nothing carrying them is smaller, it is kept as it is.
- **`W_NO_RIGHTS`** marks a file whose outputs, or kept original, carry none of the five licence fields. Digital Source Type alone doesn't count. It isn't given with `--strip-all`, or for SVGs.

Re-encoding converts a wide-gamut image, such as a Display P3 photo, to sRGB, and colours outside sRGB are clipped. The score compares against the input converted to sRGB too, so it doesn't see this.

## Where outputs go

An output goes in `--out-dir`, or next to its input, named after the input with the output format's extension. An output in the input's own format keeps the input's extension when it fits, such as `.jpeg` or `.PNG`.

- **Replacing the input:** an output that would replace its own input fails the file with `E_OUTPUT_IS_INPUT` unless `--in-place` is given. Without `--out-dir`, that is every file in `same` mode and every SVG; a file already in the format asked for (a WebP in `webp`, an AVIF in `avif`, either in `suite`); in `suite`, a JPEG or PNG whose fallback isn't the input unchanged, which is most camera JPEGs; and a file whose fallback in its own format is written (`W_NOT_CONVERTED`). So `suite` all but needs `--out-dir`. `--out-dir` avoids it only by pointing somewhere else, so an `--out-dir` that is the input's own folder still fails, however it is spelt. The one exception is a suite's fallback that is the input unchanged: it is already in place, so it isn't written.
- **Existing files:** when an output already exists, the file is `skipped` with `W_OUTPUT_EXISTS`, unless `--overwrite` is given. The outputs the mode aims for (the AVIF and WebP in `suite`) are checked before any work is done, so re-running a batch skips finished files quickly.
- **Safe writes:** each output is written to a temp file in its destination folder, and the files are renamed into place only once every one of them is written. Stopping a run ([cli.md](./cli.md#stopping)), or a failed write, leaves no temp files. `--dry-run` works everything out and writes nothing.

## Batches

`wio` runs many files with the same rules, several at once, each in a child process of its own, because scoring blocks the thread it runs on, and each process has its own pool of threads for sharp's work. A crash inside sharp's native code then fails only that file, with `E_INTERNAL`. Each encode itself runs on one thread: libaom splits an AVIF into tiles when given more, which makes it larger at the same quality and makes its bytes depend on the machine's CPU count. So one large image takes longer than it would with every core behind it, but the files come out smaller and the same everywhere. `--concurrency` is how many quality scores run at once, one fewer than the CPU count by default, capped at one per 4 GiB of memory, because scoring a very large image can take that much. A run of that many files or more optimises that many at once, each scoring one candidate at a time. A run of fewer shares the scores out between its files, so each scores its candidates side by side on threads of its own, which speeds up `suite` most, as its formats are searched together. A quality search with threads to spare also tries the qualities it may need next while it waits for the one it needs, keeping only those it would have tried one at a time, so the outputs are the same.

- **Conflicts:** before any work, an input fails with `E_OUTPUT_CONFLICT` when one of its possible outputs could land on another input, or on a path an earlier input's outputs could use. For example, `photo.png` and `photo.jpg` would both write `photo.webp`. Formats come from the first bytes of each file, so a PNG named `photo.jpg` counts as writing `photo.png`. The same file given twice also conflicts. Run such inputs separately, each with its own `--out-dir`.
- **Unexpected errors:** a bug hit by one file fails that file with `E_INTERNAL`, and the rest of the batch carries on.
- **Stopping:** a run stops once every file in progress has stopped and removed its temp files. Files that finished before then keep their outputs.

[json-contract.md](./json-contract.md) describes the result and the progress events.

## Results

Each file's result has a `status` of `optimised`, `kept-original`, `skipped` or `failed`, with the input's size and, once inspected, its displayed width and height. A problem with the file itself makes it `failed`, with an `error.code` of one of:

| Code | Meaning |
| --- | --- |
| `E_READ` | The file can't be read |
| `E_UNSUPPORTED_FORMAT` | It isn't a PNG, JPEG, WebP, AVIF or SVG |
| `E_ANIMATED` | It's animated |
| `E_DECODE` | Its header or image data can't be decoded |
| `E_OUTPUT_IS_INPUT` | An output would replace the input without `--in-place` |
| `E_WRITE` | An output can't be written |

Each output reports its role, path, format, width and height, method (`strip`, `svgo`, `lossy`, `lossless` or `near-lossless`), quality, size, saving, score, verdict, the metadata it dropped, and the rights it carries. SVG outputs also report their gzipped size.
