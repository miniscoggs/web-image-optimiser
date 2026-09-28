# Changelog

Notable changes to web-image-optimiser, newest first. A change to what the optimiser decides for the same input, such as a different format, method or quality after an engine update, is listed as an API change, and so is any change to the JSON contract's `schemaVersion`.

## Unreleased

Nothing released yet. Changes since work began:

- The `wio` command line (also `web-image-optimiser`): optimising with `--to`, `--target`, `--out-dir`, `--in-place`, `--overwrite`, `--recursive`, `--dry-run`, `--json`, `--ndjson`, `--markup` and `--concurrency`, and `wio compare`. Folders and glob patterns expand to their images, leaving out an earlier run's outputs. See `docs/cli.md`.
- `FileResult` has the image's `width` and `height`, and with the CLI's `--markup`, its `markup`. A new `CompareResult`, which `wio compare --json` prints.
- The error codes `E_DIMENSIONS_MISMATCH` and `E_TOO_SMALL_TO_SCORE`, for comparisons, and the CLI's usage error code `E_NO_INPUTS`.
- An agent guide, `SKILL.md`, for a project to copy into its skills.
- `wio ui [folder] [--port <n>] [--no-open]`: a local server for the comparison UI on 127.0.0.1, behind a session token, that answers only its own page, reads only images and opens the browser without putting the token on its command line, and whose runs, re-encodes and diff maps go into a temp folder it removes when stopped. It needs no web framework.
- The comparison UI's page: pick or drop images, choose `--to` and `--target`, run them with each file's progress (an image whose outputs would clash fails as it would on the command line), read the results table, copy the equivalent `wio` command, export the run's `RunResult`, and copy a suite run's `<picture>` markup. It follows the system's light or dark theme.
- The comparison UI's viewer: a finished file's outputs beside the original, zoomed and panned together (fit, 100% at one image pixel per screen pixel, 200%, 400%, or the scroll wheel), one output wiped against the original, and a diff overlay with its opacity.
- The comparison UI's quality sliders, which re-encode a WebP, AVIF or JPEG output at another quality and show its size, score and verdict live, and its Write button, which saves the output shown beside its original by the command line's rules, asking before it replaces the original or another file. It is the only way the UI changes the folder served.
- PNG outputs try a palette PNG (at most 256 colours, as few as the quality allows) beside lossless PNG, in `same` mode for PNG inputs and for every suite fallback. The comparison UI's quality slider now covers PNG outputs too, re-encoding them as a palette. It changed these decisions at the default target:
  - `same`, `screenshot.png`: a PNG strip of 47.7 kB became a palette PNG at quality 63, 11.6 kB.
  - `same`, `logo-alpha.png`: a PNG strip of 4.66 kB became a palette PNG at quality 1, 1.15 kB.
  - `same`, `text-chunks.png`: a lossless PNG of 119 kB became a palette PNG at quality 69, 29.8 kB.
  - `suite`, `screenshot.png`: the fallback went from a JPEG at quality 90 (27.8 kB) to a palette PNG (11.6 kB); the AVIF and WebP are unchanged.
  - `suite`, `logo-alpha.png`: the AVIF, WebP and PNG strip became one palette PNG of 1.15 kB, since the AVIF (1.61 kB) and WebP (2.23 kB) are now larger than the fallback and the chain rule drops them.
  - `suite`, `display-p3.jpg`: the fallback went from the JPEG's strip (6.50 kB, with `W_ICC_KEPT`) to a palette PNG at quality 50 (3.18 kB), without the warning.
  - `suite`, `lossless.webp`: a palette PNG of 1.21 kB became the fallback, where there was none, and the lossless WebP (2.81 kB), now larger than it, was dropped; the AVIF is unchanged.
- Batches run each lane in a child process rather than a worker thread, so each has its own pool of threads for sharp's work: 9 AVIF photos went from 270 s to 140 s on a 20-thread machine, with the same outputs. A crash inside sharp's native code now fails only that file, with `E_INTERNAL`. The UI server's re-encodes and diff maps run in a child process too.
- After a run, the comparison UI notes each file its copied command would fail because an output replaces its original, or skip because an output exists, with the flag that allows it.
- The comparison UI starts at `suite` mode and the `web` target, where the command line's defaults stay `webp` and `high`.
- `wio` is an application, a CLI and a local UI, not a library: `package.json` is private, so nothing is published to npm, and there is no importable API and no JSON Schema files. Install it from a clone with `npm link`.
