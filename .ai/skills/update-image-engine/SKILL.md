---
name: update-image-engine
description: Bump sharp, SVGO or the SSIMULACRA 2 WASM crate, and treat every change in what the optimiser decides as an API change.
---

# Update the image engine

The golden tests in `tests/golden/` pin what `optimiseFile` decides for every fixture in every mode. `tests/golden/golden.json` records each result's status, error and warning codes, and each output's role, format, method, quality and size. The tests require the same decisions and codes, quality within 3 and size within 10%, on every CI leg. Any other change is an API change, even when it's an improvement.

## Steps

1. Bump one engine at a time, so any change has one cause.
   - **sharp:** `npm install sharp@latest`. Check that `tests/package.test.ts` still passes, since its `engines.node` must accept ours, and note the new `sharp.versions` (`vips`, `aom`, `webp`, `mozjpeg`).
   - **SVGO:** `npm install svgo@latest`. Compare its `preset-default` plugin list with the overrides in `src/svg/optimiseSvg.ts`: `cleanupIds`, `inlineStyles` and `removeDesc` must stay off, `removeViewBox` and `removeTitle` must not be active, and `removeUnknownsAndDefaults` must keep `role`. `src/inspect/inspectSvg.ts` also relies on two gaps in SVGO's API: no parser is exported, so a plugin that changes nothing captures the tree (svg/svgo#1611), and the editor namespaces come from the underscore export `_collections`. Check whether the new version exports a parser, and that `_collections` still exists (the inspect tests fail if it doesn't).
   - **WASM crate:** edit `wasm/Cargo.toml`, start Docker and run `npm run build:wasm`, then commit `wasm/pkg`.
2. Run `npm run lint`, `npm run build` and `npm test`.
3. Run the checks that belong to the engine you bumped:
   - **sharp:** `node scripts/bench-encoders.mjs --target 80` and `--target 90`. If a different setting now wins, change the constants in `src/encode/`, and update the tables in `docs/encoding.md` either way.
   - **WASM crate:** the libjxl agreement test in `tests/wasm/ssimulacra2.test.ts` must still pass (within 0.5). Re-run `node wasm/bench.mjs`, and update the speed figures in `.ai/design-patterns.md`.
4. If a golden test fails, read each failure: it shows only the values out of tolerance. Decide whether the change is acceptable. A smaller file at the same target is usually welcome; a lost output, a new warning or a quality jump needs a reason.
5. Regenerate the expectations with `node scripts/update-golden.mjs` (after `npm run build`), and review `git diff tests/golden/golden.json` line by line. Every changed decision is an API change.
6. Under **Unreleased** in `CHANGELOG.md`, record the engine's new version and every changed decision (the fixture, the mode, and what changed).
7. Push, then run CI manually on the branch with `gh workflow run ci.yml --ref <branch>`: a pull request runs the golden tests only on Ubuntu, and a manual run covers every OS. Check that every leg passes. Encoded bytes can differ between platforms, so a failure on one leg only is a platform difference to investigate. Don't widen the tolerances to hide it.

## Notes

- AVIF output depends on libvips' thread count, because libaom splits an image into tiles across threads. `optimiseFile` pins `sharp.concurrency(1)` for this reason, and so does the encoder benchmark. Keep it pinned in anything that produces golden values.
- Fixtures are committed and are never regenerated as part of an engine bump. `fixtures/generate.mjs` is only for changing a fixture.
