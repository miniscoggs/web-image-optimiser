# Command line

The package installs one command under two names, `wio` and `web-image-optimiser`. It has two commands: optimise, the default, and `compare`. It never prompts, so scripts and agents can drive it. [json-contract.md](./json-contract.md) describes its JSON output, and [modes.md](./modes.md) how it chooses what to write.

## Optimising

```
wio [optimise] <inputs...> [options]
```

`optimize` works too, and so does leaving the command name out.

| Flag | Meaning |
| --- | --- |
| `--to <mode>` | What to write: `webp` (the default), `avif`, `same` (each input's own format) or `suite` (AVIF, WebP and a JPEG or PNG fallback for `<picture>`) |
| `--target <preset\|number>` | The lowest SSIMULACRA 2 score an output may have: `visually-lossless` (90), `excellent` (85), `high` (80, the default) or `web` (70), or a number from 0 to 100. SVGs always use 90 |
| `--out-dir <dir>` | Write into this folder instead of beside each input |
| `--in-place` | Let an output replace its own input |
| `--overwrite` | Let an output replace an existing file that isn't its input |
| `--recursive` | Include the subfolders of folders |
| `--dry-run` | Work everything out and report it, but write nothing |
| `--json` | Print one `RunResult` as JSON on stdout |
| `--ndjson` | Print one JSON event per line on stdout as the run goes |
| `--markup` | Add `<picture>` markup for each file. Needs `--to suite` |
| `--concurrency <n>` | How many files to optimise at once. Defaults to one fewer than the CPUs, and at most one per 4 GiB of memory |
| `--version`, `--help` | Print the version, or the help with examples and exit codes |

### Inputs

- **Files** are optimised whatever their names: the format comes from the bytes.
- **Folders** give the images at their top level, found by extension (`.png`, `.jpg`, `.jpeg`, `.webp`, `.avif` or `.svg`, in any case). `--recursive` adds their subfolders. Hidden files and folders, whose names start with `.`, are left out.
- **Glob patterns** give the images they match, again by extension. Quote them so the shell passes them on (`"src/**/*.png"`); the Windows shells never expand them anyway, and `\` works as a separator there. They match case-insensitively on Windows and macOS, like their file systems. A path that exists is always taken as it is, even with glob characters in its name, such as `photo (1).png`. A pattern that matches no image is passed on as a path and fails with `E_READ`, as it would in a shell.

Each file is listed once, even when several inputs name it, and files run in order of path.

A folder or glob leaves out two kinds of file, so running the same command twice works:

- **Earlier outputs:** a file in the mode's WebP or AVIF format named like another image beside it, such as `photo.webp` beside `photo.jpg`. The second run then skips `photo.jpg` with `W_OUTPUT_EXISTS` rather than optimising `photo.webp` too. Name a file to include it anyway.
- **The output folder**, when `--out-dir` is inside a folder being scanned.

When the inputs hold no images at all, `wio` exits 2 with `E_NO_INPUTS`.

### Where outputs go

Without `--out-dir`, each output goes beside its input, named after it with the output format's extension. With `--out-dir`, files found in a folder's subfolders, or below a glob pattern's fixed start, go into the same subfolders of the output folder; files named directly go straight into it. So `wio photos --recursive --out-dir web` writes `photos/blog/hero.jpg` to `web/blog/hero.webp`.

An output that would replace its own input fails the file with `E_OUTPUT_IS_INPUT`, unless `--in-place` is given. That happens in `same` mode, and to SVGs, which always stay SVG, whenever `--out-dir` is left out. An output that already exists makes the file `skipped` with `W_OUTPUT_EXISTS`, unless `--overwrite` is given. The messages of both name the flag that fixes them.

### Output

Without `--json` or `--ndjson`, stdout gets a table with a row for each output, or for each file that has none:

```
File       Output    Format  Quality               Size  Saving  Score  Verdict            Notes
hero.jpg   avif      avif    q62      250 kB -> 48.2 kB   80.7%   80.4  very-high
           webp      webp    q71      250 kB -> 61.0 kB   75.6%   81.2  very-high
           fallback  jpeg    strip     250 kB -> 240 kB    4.0%  100.0  visually-lossless
anim.webp  failed                                 854 B                                    E_ANIMATED

2 files: 1 optimised, 1 failed. 250 kB -> 48.2 kB, 80.7% smaller.

anim.webp: E_ANIMATED Animated images are not supported
```

`Quality` is the encoder quality (`q62`), or the method when it has none: `lossless`, `near-lossless` with its level, `strip` (the input with its metadata removed) or `svgo`. The summary counts each file's smallest output. Every error and warning follows in full, then the markup with `--markup`. The table has colour when stdout is a terminal that supports it, and none when `NO_COLOR` is set. While the run goes, a terminal's stderr shows how many files are done.

With `--json`, stdout gets exactly one `RunResult` on one line, and with `--ndjson`, one event per line as it happens. Messages, usage errors and progress always go to stderr, so stdout stays parseable.

### Markup

With `--to suite --markup`, each file gets the HTML that shows it: a `<picture>` with a `<source>` for its AVIF and WebP, and an `<img>` for its fallback, or just the `<img>` when there is one output. It follows the table, each snippet after an HTML comment naming the input, or goes in each `FileResult`'s `markup` with `--json` and `--ndjson`.

```html
<picture>
  <source type="image/avif" srcset="blog/hero.avif">
  <source type="image/webp" srcset="blog/hero.webp">
  <img src="blog/hero.jpg" width="1600" height="1067" alt="TODO: describe image" loading="lazy" decoding="async">
</picture>
```

- The URLs are relative to `--out-dir`, or the paths as reported without it, with `/` separators and each part percent-encoded. Adjust them to where the page serves the images.
- `width` and `height` are the image's, so the page doesn't shift as it loads.
- `alt` is always `TODO: describe image`: only someone who knows what the image is for can write it. Replace it before publishing.
- Remove `loading="lazy"` from images visible when the page opens, such as a hero image, so they load first.
- A kept-original file gets an `<img>` of its input. Failed and skipped files get none.

## Comparing

```
wio compare <original> <candidate> [--diff <file.png>] [--overwrite] [--json]
```

Scores a candidate against its original with SSIMULACRA 2, and prints the score, its verdict and the size difference:

```
Score  68.1, noticeable: slightly annoying artifacts
Size   259 kB -> 8.34 kB, 96.8% smaller
Diff   diff.png
```

Both images must be PNG, JPEG, WebP or AVIF, and the same size once EXIF orientation is applied. `--diff` writes a PNG heat map of where they differ: red to yellow over a dimmed grey copy of the original. It never replaces either image (`E_OUTPUT_IS_INPUT`), and replaces another existing file only with `--overwrite`; otherwise the score is still printed, with `W_OUTPUT_EXISTS`. `--json` prints one `CompareResult`. A failure, such as `E_DIMENSIONS_MISMATCH`, goes to stderr, or into the result's `error` with `--json`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No file failed. Skipped and kept-original files are not failures, and an unreached target is only a warning |
| 1 | At least one file failed, or the comparison failed |
| 2 | Usage error: an unknown command or flag, a bad value, `--json` with `--ndjson`, `--markup` without `--to suite`, or no images (`E_NO_INPUTS`). Nothing is printed on stdout |
| 130 | Stopped by Ctrl+C |
| 143 | Stopped by SIGTERM |

## Stopping

Ctrl+C or SIGTERM stops the run once each file in progress finishes its current step, an encode or a score. That can take up to half a minute on a very large image. The files in progress leave no temp files, files already done keep their outputs, and no `RunResult` or `run-done` event is printed. A second Ctrl+C quits at once. Outputs are only on disk as temp files while they're being written, so quitting at once leaves one behind only when it lands during a write. The temp files are named `.<output name>.wio-<8 hex digits>.tmp`, in the output's folder.

## Examples

```sh
wio photos                                   # WebP beside each image in photos/
wio photos --recursive --out-dir web         # every subfolder too, mirrored into web/
wio "src/**/*.png" --to same --in-place      # shrink PNGs where they are
wio hero.jpg --to suite --out-dir web --markup
wio photos --target excellent --to avif --out-dir web
wio photos --dry-run --json > plan.json      # what would be written, as JSON
wio compare photo.png photo.webp --diff diff.png
```
