# Code standards

## Safety rules

These are promises to users. Never weaken them, and cover every change to the write path with tests.

- Never write an output larger than its input.
- Every file that doesn't fail ends the run without its metadata. When no candidate is smaller than the input, write the lossless strip of the source in its own format instead, with the warning `W_NOT_CONVERTED` when another format was asked for. A strip only removes bytes, so it is never larger. The result is `kept-original`, with nothing written, only when there is nothing to strip.
- The only metadata kept is an EXIF block holding just Orientation (when it isn't 1), a non-sRGB ICC profile (with the warning `W_ICC_KEPT`), and what changes how the pixels decode or display: JPEG's APP0 "JFIF" and APP14 "Adobe" segments, PNG's `tRNS`, `gAMA`, `cHRM`, `sRGB`, `cICP`, `mDCV` and `cLLI` chunks, and AVIF's `irot` and `imir` properties, which hold its orientation.
- An output that lands on its input fails with `E_OUTPUT_IS_INPUT` unless `--in-place` is given. Detect it by file identity, or by path compared case-insensitively on Windows and macOS where there is none. `--out-dir` doesn't exempt an output that lands on its input. The only exception is an output identical to the input, such as a suite's unchanged fallback, which isn't written at all.
- An existing output that is not the input is only replaced with `--overwrite`. Otherwise the file is skipped with `W_OUTPUT_EXISTS`.
- Every write goes to a temp file in the destination directory and is then renamed atomically. A run stopped by Ctrl+C or SIGTERM leaves no temp files behind. The one exception is a second Ctrl+C, which quits at once: a temp file can be left only if it lands mid-write, and `docs/cli.md` says so (the user's decision).
- `--dry-run` writes nothing.
- The CLI never prompts.
- The UI server listens on 127.0.0.1 only, needs the session token on every request, refuses a request that says it comes from another page (its `Origin` or `Sec-Fetch-Site`), takes JSON only as `application/json`, and sends no CORS headers. It reads only images, in the folder it serves and its own temp folder, refusing any path that leads outside them. It writes into the folder it serves only through `POST /api/write`, the UI's Write, which keeps the rules above: nothing larger than the original, the original replaced only with `inPlace`, another file only with `overwrite`, and an atomic write. Everything else it writes goes into its temp folder.

## JSON contract

Agents drive `wio` through `--json` and `--ndjson`, so that output is a public API.

- With `--json`, stdout carries exactly one `RunResult` (or `CompareResult` for `wio compare`) and nothing else. With `--ndjson`, stdout carries one event per line. Without either, stdout carries the human-readable result, the table or the comparison. Logs, progress, usage errors and a failed comparison's message always go to stderr, and a usage error prints nothing on stdout.
- Every result shape must be a zod schema in `src/schema/`, and the shipped JSON Schema files must be generated from those schemas by the build. Never hand-edit the generated files.
- Adding a field is a minor change. Renaming or removing a field, or changing its meaning, bumps `schemaVersion` and is recorded in `docs/json-contract.md`.
- Error and warning codes must be defined in `src/schema/codes.ts`. Once released, never rename, remove or reuse a code.
- Exit codes: 0 when no file failed, 1 when at least one file failed (or a comparison failed), 2 for usage errors, and 130 or 143 when stopped by Ctrl+C or SIGTERM. Skipped and kept-original files are not failures, and an unreached quality target is a warning.
