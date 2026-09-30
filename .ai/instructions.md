# Instructions

web-image-optimiser (command `wio`) prepares images for websites. It reads PNG, JPEG, WebP, AVIF and SVG, strips metadata apart from the copyright, licence and AI-origin fields Google Images reads, and writes the smallest output that stays above an SSIMULACRA 2 quality target. It is an application, a CLI and an Electron desktop app, not a library: `package.json` is private, nothing is published to npm, and no other project imports its modules. It needs no external binaries, and must behave the same on Windows and macOS.

## Working in this repo

- Check `.ai/skills.md` first and follow a matching project skill over a general approach.
- Question unusual or counter-intuitive logic before implementing it, and record a deliberate decision with a short comment.
- If a request conflicts with these docs, say so before proceeding and offer to follow the convention.
- After a change, review it for simplicity, then update `README.md`, `docs/*.md` and `.ai/` in the same change so no doc describes behaviour the code doesn't have. A change to a CLI flag, code or output also updates the `--help` text in `src/cli/runCli.ts`, `docs/cli.md` and the shipped agent guide, `SKILL.md`.
- When sharp, SVGO or another dependency falls short, prefer fixing or reporting it upstream. Keep any local workaround small, with a comment linking the upstream issue.
- Follow only this repo's steering, not that of other projects open alongside it.
- Add a line under **Unreleased** in `CHANGELOG.md` for every change a user of `wio` would notice, including every change to `tests/golden/golden.json`. Don't bump the version in an ordinary pull request: a release pull request does that (see the CI section of `design-patterns.md`).

## Commands

| Command                      | Purpose                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run build`              | Compile `src/` into `dist/`, and copy `wasm/pkg` into `dist/wasm`                                        |
| `npm link`                   | After `npm run build`, put `wio` and `web-image-optimiser` on the PATH, running this clone's `dist/`. It is how `wio` is installed, since it is never published |
| `npm run build:desktop`      | `npm run build`, then bundle the desktop app's main process and preload with Vite into `desktop/build/main` and `desktop/build/preload`, and build the React UI into `desktop/build/renderer`, whose scripts `tests/dist.test.ts` then checks hold no engine code. `npx electron .` then runs the built app |
| `npm run package:desktop`    | `npm run build:desktop`, then render the app's icons (`scripts/build-icons.mjs`) into `desktop/build/icons/`, and build this OS's unsigned installer with electron-builder (`desktop/electron-builder.yml`) into `release/`: an NSIS `.exe` on Windows, a `.dmg` on macOS. Add `-- --dir` for only the unpacked app. In an editor that watches the folder, such as VS Code, electron-builder's rename of the Electron it unpacks fails with `EPERM`: add `--config.directories.output=<a folder outside the repo>` |
| `npm run dev`                | `npm run build`, then run the desktop app with the page served by Vite with hot reload (`scripts/dev.mjs`). Run it again after changing `src/` or `desktop/`, and quit the app to stop it |
| `npm run lint`               | ESLint, then a Prettier check                                                                            |
| `npm run lint:fix`           | ESLint and Prettier with fixes applied                                                                   |
| `npm test`                   | Every test except the desktop app's end-to-end test, then `npm run typecheck`. The golden tests make it take a few minutes |
| `npm run test:fast`          | Every test except the golden tests and the desktop app's end-to-end test (about 40 s), then the type-check. Use it while iterating |
| `npm run test:desktop`       | After `npm run build:desktop`, only the desktop app's end-to-end test, `tests/desktop/app.test.ts` (about 25 s), which drives the built app in its own window, or the packaged app whose executable `WIO_DESKTOP_APP` names. On Linux, run it under `xvfb-run` |
| `npm run typecheck`          | Type-check `src/` and `tests/`, then the UI in `ui/` with `tests/ui/`, which has its own browser `tsconfig` |
| `npm run test:golden`        | Only the golden tests in `tests/golden/`                                                                 |
| `npm run build:wasm`         | Rebuild `wasm/pkg` in the pinned Docker image (needs a running Docker daemon, no local Rust). Run it after any change under `wasm/`, and commit the result |
| `node wasm/bench.mjs`        | Time one score at 1 MP and 12 MP. Re-run it after changing the WASM build, and update the numbers in `design-patterns.md` |
| `node scripts/bench-encoders.mjs [--target 80] [--only <prefix>]` | After `npm run build`, compare AVIF, WebP and palette PNG encoder settings by the bytes each needs to reach the target score, `--only` running the settings whose names start with a prefix, eg `"png palette"`. Re-run it after bumping sharp, and update `docs/encoding.md` and the constants in `src/encode/` |
| `node fixtures/ssimulacra2/generate.mjs <ssimulacra2> <libjxl version>` | Rebuild the metric validation pairs and record libjxl's reference scores, using the `ssimulacra2` binary from a libjxl release. Run it only to change the pairs |
| `node scripts/update-golden.mjs` | After `npm run build`, rewrite `tests/golden/golden.json` from what the optimiser decides for every fixture in every mode. Every change it makes is an API change: follow the `update-image-engine` skill |
| `node fixtures/generate.mjs` | Rebuild the synthetic fixtures and `manifest.json`; `--photos` also re-derives the photos. Run it only to change a fixture, and review every changed file |
