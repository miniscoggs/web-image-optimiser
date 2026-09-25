# Code standards

## Safety rules

These are promises to users. Never weaken them, and cover every change to the write path with tests.

- Never write an output larger than its input.
- Every file that doesn't fail ends the run without its metadata. When no candidate is smaller than the input, write the lossless strip of the source in its own format instead, with the warning `W_NOT_CONVERTED` when another format was asked for. A strip only removes bytes, so it is never larger. The result is `kept-original`, with nothing written, only when there is nothing to strip.
- The only metadata kept is an EXIF block holding just Orientation (when it isn't 1), a non-sRGB ICC profile (with the warning `W_ICC_KEPT`), and the JPEG APP14 "Adobe" segment, which controls colour decoding.
- An output whose real path matches its input's fails with `E_OUTPUT_IS_INPUT` unless `--in-place` is given. Compare paths case-insensitively on Windows and macOS. `--out-dir` doesn't exempt an output that lands on its input.
- An existing output that is not the input is only replaced with `--overwrite`.
- Every write goes to a temp file in the destination directory and is then renamed atomically. A run stopped by Ctrl+C or SIGTERM leaves no temp files behind.
- `--dry-run` writes nothing.
- The CLI never prompts.

## JSON contract

Agents drive `wio` through `--json` and `--ndjson`, so that output is a public API.

- With `--json`, stdout carries exactly one `RunResult` and nothing else. With `--ndjson`, stdout carries one event per line. Logs and human-readable output always go to stderr.
- Every result shape must be a zod schema in `src/schema/`, and the shipped JSON Schema files must be generated from those schemas by the build. Never hand-edit the generated files.
- Adding a field is a minor change. Renaming or removing a field, or changing its meaning, bumps `schemaVersion` and is recorded in `docs/json-contract.md`.
- Error and warning codes must be defined in `src/schema/codes.ts`. Once released, never rename, remove or reuse a code.
- Exit codes: 0 when no file failed, 1 when at least one file failed, 2 for usage errors. Skipped and kept-original files are not failures, and an unreached quality target is a warning.
