# Changelog

Notable changes to web-image-optimiser, newest first. A change to what the optimiser decides for the same input, such as a different format, method or quality after an engine update, is listed as an API change, and so is any change to the JSON contract's `schemaVersion`.

## Unreleased

Nothing released yet. Changes since work began:

- The `wio` command line (also `web-image-optimiser`): optimising with `--to`, `--target`, `--out-dir`, `--in-place`, `--overwrite`, `--recursive`, `--dry-run`, `--json`, `--ndjson`, `--markup` and `--concurrency`, and `wio compare`. Folders and glob patterns expand to their images, leaving out an earlier run's outputs. See `docs/cli.md`.
- `compareFiles` and `generatePictureMarkup` in the library.
- `FileResult` has the image's `width` and `height`, and with the CLI's `--markup`, its `markup`. A new `CompareResult` schema ships as `schema/compare-result.schema.json`.
- The error codes `E_DIMENSIONS_MISMATCH` and `E_TOO_SMALL_TO_SCORE`, for comparisons, and the CLI's usage error code `E_NO_INPUTS`.
- An agent guide ships as `dist/SKILL.md`.
