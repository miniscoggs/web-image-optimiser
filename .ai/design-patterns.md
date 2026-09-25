# Design patterns

## Data flow

Every file must move through one pipeline, with each stage in its own module under `src/`:

```
inspect -> strip / encode / svg -> decode -> score -> search -> select -> write
```

- `inspect/` reads the format (from magic bytes, never the extension), dimensions, alpha, animation and metadata.
- `strip/` removes metadata losslessly, `encode/` wraps the sharp encoders and `svg/` wraps SVGO. Each produces candidate bytes.
- `metrics/` decodes each candidate and scores it against the decoded source, never against another candidate.
- `search/` finds the lowest passing quality for a format. It is pure, with the encoder and scorer injected.
- `pipeline/` applies the mode rules, picks the smallest passing candidate and writes it through the safe-write path. When no candidate beats the input, it writes the lossless strip instead.

## Thin entry points

The CLI (`src/bin/`, `src/cli/`) and the UI server (`src/server/`) hold no image logic. They parse input, call the same library functions a programmatic caller would, and render the results.

- Only `src/bin/` reads `process.env` or `process.argv`. Every other module receives its options as arguments.
- No module does work at import time.
- Every module in `src/` lives in its own folder with an `index.ts`. `src/index.ts` is the library entry.
