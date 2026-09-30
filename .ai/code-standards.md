# Code standards

## Safety rules

These are promises to users. Never weaken them, and cover every change to the write path with tests.

- Never write an output larger than its input.
- Every file that doesn't fail ends the run without its metadata, apart from its rights fields. When no candidate is smaller than the input, write the lossless strip of the source in its own format instead, with the warning `W_NOT_CONVERTED` when another format was asked for. The rights count in every size comparison, so a strip carrying them can be larger than its input: then it drops the added fields, and when even the input's own don't fit, those too, with `W_RIGHTS_NOT_ADDED`, so the rest of the metadata always goes (the user's decision). The result is `kept-original`, with nothing written, only when the input holds nothing but its rights (its strip, carrying them, is the input itself), or when a resized image has nothing smaller at the new width (`W_NOT_RESIZED`).
- The only metadata kept is the rights fields (Creator, Credit Line, Copyright Notice, Web Statement of Rights, Licensor URL and Digital Source Type) as one XMP packet, unless `stripAll` is given, an EXIF block holding just Orientation (when it isn't 1), a non-sRGB ICC profile (with the warning `W_ICC_KEPT`), and what changes how the pixels decode or display: JPEG's APP0 "JFIF" and APP14 "Adobe" segments, PNG's `tRNS`, `gAMA`, `cHRM`, `sRGB`, `cICP`, `mDCV` and `cLLI` chunks, and AVIF's `irot` and `imir` properties, which hold its orientation.
- An output that lands on its input fails with `E_OUTPUT_IS_INPUT` unless `--in-place` is given. Detect it by file identity, or by path compared case-insensitively on Windows and macOS where there is none. `--out-dir` doesn't exempt an output that lands on its input. The only exception is an output identical to the input, such as a suite's unchanged fallback, which isn't written at all.
- An existing output that is not the input is only replaced with `--overwrite`. Otherwise the file is skipped with `W_OUTPUT_EXISTS`.
- Every write goes to a temp file in the destination directory and is then renamed atomically. A run stopped by Ctrl+C or SIGTERM leaves no temp files behind. The one exception is a second Ctrl+C, which quits at once: a temp file can be left only if it lands mid-write, and `docs/cli.md` says so (the user's decision).
- `--dry-run` writes nothing.
- The CLI never prompts.
- The app API has no network port: it answers only the `Request`s its caller hands it, and `handle` never takes or gives an absolute path. It reads only the files `open` registered and its own temp folder, refusing any other ref, and takes JSON only as `application/json`. It writes only into its temp folder, which `close` removes, and through `saveOutput` and `saveSuites`, whose paths the desktop app's OS dialogs choose. Neither saves an output larger than its original. `saveOutput` replaces a file, the original included, only with `replace`, which is set only once the OS dialog's own prompt has confirmed it, and `saveSuites` never replaces a file, taking the next free name instead.

- The desktop app's page has no Node: its window runs with `contextIsolation` and `sandbox` on and `nodeIntegration` off, and every page is kept on the `wio://app` origin, unable to navigate away, open a window or attach a webview, with web links sent to the system's browser and every permission request refused. The page reaches the main process only through the preload's `window.wio`, and main answers a call only from the app window's own main frame on `wio://app`.
- The `wio:` protocol is the page's only server: `/api/` goes to the app API's `handle`, and anything else to a file inside the renderer build, or 404, with the app API's headers and CSP on every response. It passes the page to Vite only in development, never in a packaged app.
- Every path the main process opens or saves to comes from an OS dialog, a file dropped on the page (whose path only the preload can read), the OS (the app's command line, a second launch's, or macOS's `open-file`) or the app itself, never from the page, which holds only refs. The options it remembers are checked field by field as a run checks them, and a bad field is dropped.

## JSON contract

Agents drive `wio` through `--json` and `--ndjson`, so that output is a public API.

- With `--json`, stdout carries exactly one `RunResult` (or `CompareResult` for `wio compare`) and nothing else. With `--ndjson`, stdout carries one event per line. Without either, stdout carries the human-readable result, the table or the comparison. Logs, progress, usage errors and a failed comparison's message always go to stderr, and a usage error prints nothing on stdout.
- Every result shape must be a zod schema in `src/schema/`, and `docs/json-contract.md` must describe it.
- Adding a field is a minor change. Renaming or removing a field, or changing its meaning, bumps `schemaVersion` and is recorded in `docs/json-contract.md`.
- Error and warning codes must be defined in `src/schema/codes.ts`. Once released, never rename, remove or reuse a code.
- Exit codes: 0 when no file failed, 1 when at least one file failed (or a comparison failed), 2 for usage errors, 130 or 143 when stopped by Ctrl+C or SIGTERM, and 141 when stopped because the reader of its output went. Skipped and kept-original files are not failures, and an unreached quality target is a warning.
