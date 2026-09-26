# Instructions

web-image-optimiser (command `wio`) prepares images for websites. It reads PNG, JPEG, WebP, AVIF and SVG, always strips metadata, and writes the smallest output that stays above an SSIMULACRA 2 quality target. It ships as one npm package with no external binaries, and must behave the same on Windows and macOS.

## Working in this repo

- Check `.ai/skills.md` first and follow a matching project skill over a general approach.
- Question unusual or counter-intuitive logic before implementing it, and record a deliberate decision with a short comment.
- If a request conflicts with these docs, say so before proceeding and offer to follow the convention.
- After a change, review it for simplicity, then update `README.md`, `docs/*.md` and `.ai/` in the same change so no doc describes behaviour the code doesn't have. A change to a CLI flag, code or output also updates the `--help` text in `src/cli/runCli.ts`, `docs/cli.md` and the shipped agent guide, `SKILL.md`.
- When sharp, SVGO or another dependency falls short, prefer fixing or reporting it upstream. Keep any local workaround small, with a comment linking the upstream issue.
- Follow only this repo's steering, not that of other projects open alongside it.
- Add a line under **Unreleased** in `CHANGELOG.md` for every change a user of the package would notice, including every change to `tests/golden/golden.json`. Don't bump the version in an ordinary pull request: a release pull request does that (see the CI section of `design-patterns.md`).

## Commands

| Command                      | Purpose                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run build`              | Compile `src/` into `dist/`, copy `wasm/pkg` into `dist/wasm` and `SKILL.md` into `dist/`, write the JSON Schema files into `dist/schema`, and build the UI in `ui/` into `dist/ui` with Vite |
| `npm run dev:ui`             | Serve the UI with hot reload on `http://127.0.0.1:5173`, passing API requests to a `node dist/bin/index.js ui <folder> --port 5174` started first |
| `npm run lint`               | ESLint, then a Prettier check                                                                            |
| `npm run lint:fix`           | ESLint and Prettier with fixes applied                                                                   |
| `npm test`                   | Every test, then `npm run typecheck`. The golden tests make it take a few minutes                          |
| `npm run test:fast`          | Every test except the golden and browser tests (about 20 s), then the type-check. Use it while iterating  |
| `npm run test:browser`       | Only the Playwright flow in `tests/browser/`, which drives the built UI in Google Chrome. Run `npm run build` first |
| `npm run typecheck`          | Type-check `src/` and `tests/`, then the UI in `ui/` with `tests/ui/`, which has its own browser `tsconfig` |
| `npm run test:golden`        | Only the golden tests in `tests/golden/`                                                                 |
| `npm run build:wasm`         | Rebuild `wasm/pkg` in the pinned Docker image (needs a running Docker daemon, no local Rust). Run it after any change under `wasm/`, and commit the result |
| `node wasm/bench.mjs`        | Time one score at 1 MP and 12 MP. Re-run it after changing the WASM build, and update the numbers in `design-patterns.md` |
| `node scripts/bench-encoders.mjs [--target 80]` | After `npm run build`, compare AVIF and WebP encoder settings by the bytes each needs to reach the target score. Re-run it after bumping sharp, and update `docs/encoding.md` and the constants in `src/encode/` |
| `node fixtures/ssimulacra2/generate.mjs <ssimulacra2> <libjxl version>` | Rebuild the metric validation pairs and record libjxl's reference scores, using the `ssimulacra2` binary from a libjxl release. Run it only to change the pairs |
| `node scripts/update-golden.mjs` | After `npm run build`, rewrite `tests/golden/golden.json` from what the optimiser decides for every fixture in every mode. Every change it makes is an API change: follow the `update-image-engine` skill |
| `node fixtures/generate.mjs` | Rebuild the synthetic fixtures and `manifest.json`; `--photos` also re-derives the photos. Run it only to change a fixture, and review every changed file |
