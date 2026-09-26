# Changelog

Notable changes to web-image-optimiser, newest first. A change to what the optimiser decides for the same input, such as a different format, method or quality after an engine update, is listed as an API change, and so is any change to the JSON contract's `schemaVersion`.

## Unreleased

Nothing released yet. Changes since work began:

- The `wio` command line (also `web-image-optimiser`): optimising with `--to`, `--target`, `--out-dir`, `--in-place`, `--overwrite`, `--recursive`, `--dry-run`, `--json`, `--ndjson`, `--markup` and `--concurrency`, and `wio compare`. Folders and glob patterns expand to their images, leaving out an earlier run's outputs. See `docs/cli.md`.
- `compareFiles` and `generatePictureMarkup` in the library.
- `FileResult` has the image's `width` and `height`, and with the CLI's `--markup`, its `markup`. A new `CompareResult` schema ships as `schema/compare-result.schema.json`.
- The error codes `E_DIMENSIONS_MISMATCH` and `E_TOO_SMALL_TO_SCORE`, for comparisons, and the CLI's usage error code `E_NO_INPUTS`.
- An agent guide ships as `dist/SKILL.md`.
- `wio ui [folder] [--port <n>] [--no-open]` and `startUiServer` in the library: a local server for the comparison UI on 127.0.0.1, behind a session token, that answers only its own page, reads only images and opens the browser without putting the token on its command line, and whose runs, re-encodes and diff maps go into a temp folder it removes when stopped. It needs no web framework.
- The comparison UI's page: pick or drop images, choose `--to` and `--target`, run them with each file's progress (an image whose outputs would clash fails as it would on the command line), read the results table, copy the equivalent `wio` command, export the run's `RunResult`, and copy a suite run's `<picture>` markup. It follows the system's light or dark theme.
- The comparison UI's viewer: a finished file's outputs beside the original, zoomed and panned together (fit, 100% at one image pixel per screen pixel, 200%, 400%, or the scroll wheel), one output wiped against the original, and a diff overlay with its opacity.
- The comparison UI's quality sliders, which re-encode a WebP, AVIF or JPEG output at another quality and show its size, score and verdict live, and its Write button, which saves the output shown beside its original by the command line's rules, asking before it replaces the original or another file. It is the only way the UI changes the folder served.
