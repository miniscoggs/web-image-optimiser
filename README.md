# web-image-optimiser

Prepares images for websites. `wio` reads PNG, JPEG, WebP, AVIF and SVG files, strips their metadata apart from the copyright, licence and AI-origin fields Google Images reads, and writes the smallest output that stays above a perceptual quality target (SSIMULACRA 2), with a plain-language verdict when degradation would be noticeable.

> **Status:** in development. `wio` is an application, a command line and a desktop app, not a library, and it isn't published to npm: to install the command line, run `npm install`, `npm run build` and `npm link` in a clone.

## Command line

```sh
wio photos                                        # a WebP beside each image in photos/
wio photos --recursive --out-dir web              # every subfolder too, mirrored into web/
wio hero.jpg --to suite --out-dir web             # AVIF, WebP and a fallback
wio photos --max-width 1600 --out-dir web         # photos cut down to 1600 px wide
wio photos --creator "Jo Bloggs" --out-dir web    # credit the photos that have no Creator
wio photos --dry-run --json                       # what would be written, as JSON
wio compare photo.png photo.webp --diff diff.png  # the score, verdict and size change
```

`--to` picks what to write: `webp` (the default), `avif`, `same` (each file's own format) or `suite` (AVIF, WebP and a JPEG or PNG fallback for `<picture>`). `--target` sets the lowest quality allowed, `high` (80) by default, and `--max-width` shrinks wider images to a width first. The copyright and licence fields an image has are kept unless `--strip-all` is given, and `--creator`, `--credit`, `--copyright`, `--rights-url` and `--licensor-url` add those it lacks. Every output keeps the input's name with its own extension, beside the input or in `--out-dir`, and replaces an input only with `--in-place` and another existing file only with `--overwrite`. So without `--out-dir`, a file that would be replaced fails with `E_OUTPUT_IS_INPUT`: every file in `same` mode, a file already in the format asked for (a WebP in `webp` mode), and most files in `suite`. `--json` prints one result for scripts and agents, and the exit code is 0 when nothing failed, 1 when a file failed and 2 for a usage error. [docs/cli.md](./docs/cli.md) describes every flag.

## Desktop app

The desktop app, Web Image Optimiser, is where you compare outputs before saving them. Open or drop images, or send them from the OS's Open with menu, and each runs in `suite` mode at the `web` target straight away. Its grid shows the original beside the AVIF, WebP and fallback, zoomed and panned together, with a wipe and a diff overlay. Each output's target-score slider finds the smallest file at another quality, and Save, Save suite and Save all write through the OS's dialogs, taking the next free name rather than replacing a file. It has the command line's max width and metadata options.

There are unsigned installers for Windows and macOS. To run it from a clone, `npm install`, `npm run build:desktop`, then `npx electron .`. [docs/desktop.md](./docs/desktop.md) describes the app, and how to open it past the OS's warning about an unsigned app.

## Using with AI agents

Agents drive `wio` through its CLI: `--json` prints exactly one result on stdout, `--ndjson` one event per line, and the CLI never prompts. This repo has an agent guide, [SKILL.md](./SKILL.md), covering which mode to use, the commands to run, how to read the result, the exit codes and the safety rules. To give an agent the skill, copy it into the project:

- **Claude Code:** `.claude/skills/web-image-optimiser/SKILL.md`
- **A repo with `.ai/` steering:** `.ai/skills/web-image-optimiser/SKILL.md`, listed in `.ai/skills.md`

For example, from a project, with this repo cloned beside it:

```sh
mkdir -p .claude/skills/web-image-optimiser
cp ../web-image-optimiser/SKILL.md .claude/skills/web-image-optimiser/
```

[docs/json-contract.md](./docs/json-contract.md) describes the result.

## Development

Requires Node.js 24 or later.

```sh
npm install
npm run build
npm run lint
npm test
```

The desktop app's Electron shell is in `desktop/`, and its page is a React app in `ui/`, which talks to the in-process API in `src/app/` through the app's own `wio:` protocol, with no network port. `npm run dev` runs it with hot reload, and `npm run build:desktop` builds it into `desktop/build/`. Electron downloads itself the first time it's run, so installing for the command line alone doesn't fetch it. After a build, `npm run test:desktop` drives the built app end to end in a window of its own (under `xvfb-run` on Linux); `npm test` leaves it out, and CI runs it on Ubuntu when a pull request changes the app. `npm run package:desktop` builds the unsigned installer for the OS it runs on into `release/`, and pushing a `desktop-v<version>` tag builds the Windows and macOS installers into a draft GitHub release.

The SSIMULACRA 2 metric is a Rust crate in `wasm/`, compiled to WebAssembly. Its build output, `wasm/pkg`, is committed, so working on `wio` needs no Rust. After changing anything in `wasm/`, start Docker and run `npm run build:wasm`. It builds inside a pinned image with checksummed tools, so the output matches CI's rebuild byte for byte, and CI fails when the committed `wasm/pkg` is out of date. `fixtures/ssimulacra2/` holds six image pairs with scores from libjxl's reference `ssimulacra2` tool, and the tests require the WebAssembly build to stay within 0.5 of each. `node wasm/bench.mjs` times one score at 1 MP and 12 MP.

The encoder settings come from a benchmark, described in [docs/encoding.md](./docs/encoding.md). After `npm run build`, `node scripts/bench-encoders.mjs` reruns it.

Test images live in `fixtures/`, and `fixtures/manifest.json` records each one's traits, source and licence. `node fixtures/generate.mjs` rebuilds the synthetic fixtures and the manifest; add `--photos` to re-download the photos and derive them again. The output bytes vary by platform and libvips version, so run it only when changing a fixture, and review every file it rewrites before committing.

The golden tests in `tests/golden/` run every fixture through every mode and compare what the optimiser decides with `tests/golden/golden.json`, allowing quality within 3 and size within 10%. They take a few minutes, most of it on the four photos, so `npm run test:fast` runs everything else in about 20 seconds. CI runs them on Ubuntu for pull requests that change engine files, and on every OS for release pull requests. A change to `golden.json` is a change to what the tool outputs: after `npm run build`, `node scripts/update-golden.mjs` rewrites it, and the `update-image-engine` skill in `.ai/skills/` covers when and how.

## Licence

MIT. See [LICENSE](./LICENSE). The WebAssembly module includes code under the BSD-2-Clause, MIT and Unicode-3.0 licences, and `wasm/pkg/THIRD-PARTY-NOTICES.txt` lists each crate with its licence. The photos in `fixtures/` are CC0, and `fixtures/manifest.json` credits their authors and sources.
