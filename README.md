# web-image-optimiser

Prepares images for websites. `wio` reads PNG, JPEG, WebP, AVIF and SVG files, strips their metadata apart from the copyright, licence and AI-origin fields Google Images reads, and writes the smallest output that stays above a perceptual quality target (SSIMULACRA 2), with a plain-language verdict when degradation would be noticeable.

> **Status:** in development. `wio` is an application, not a library, and it isn't published to npm: to install it, run `npm install`, `npm run build` and `npm link` in a clone.

## Command line

```sh
wio photos                                        # a WebP beside each image in photos/
wio photos --recursive --out-dir web              # every subfolder too, mirrored into web/
wio hero.jpg --to suite --out-dir web             # AVIF, WebP and a fallback
wio photos --max-width 1600 --out-dir web         # photos cut down to 1600 px wide
wio photos --creator "Jo Bloggs" --out-dir web    # credit the photos that have no Creator
wio photos --dry-run --json                       # what would be written, as JSON
wio compare photo.png photo.webp --diff diff.png  # the score, verdict and size change
wio ui photos                                     # compare the outputs in the browser
```

`--to` picks what to write: `webp` (the default), `avif`, `same` (each file's own format) or `suite` (AVIF, WebP and a JPEG or PNG fallback for `<picture>`). `--target` sets the lowest quality allowed, `high` (80) by default, and `--max-width` shrinks wider images to a width first. The copyright and licence fields an image has are kept unless `--strip-all` is given, and `--creator`, `--credit`, `--copyright`, `--rights-url` and `--licensor-url` add those it lacks. Every output keeps the input's name with its own extension, beside the input or in `--out-dir`, and replaces an input only with `--in-place` and another existing file only with `--overwrite`. So without `--out-dir`, a file that would be replaced fails with `E_OUTPUT_IS_INPUT`: every file in `same` mode, a file already in the format asked for (a WebP in `webp` mode), and most files in `suite`. `--json` prints one result for scripts and agents, and the exit code is 0 when nothing failed, 1 when a file failed and 2 for a usage error. `wio ui` serves a comparison UI on 127.0.0.1, behind a session token: pick or drop images, run them, read the results, compare each output with the original (zoomed together, in a wipe or with a diff overlay), try a lossy output at other qualities, and copy the `wio` command that writes them. Its runs write into a temp folder, and the folder served changes only when you Write an output into it. [docs/cli.md](./docs/cli.md) describes every flag.

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

The browser UI behind `wio ui` is a React app in `ui/`, which `npm run build` builds into `dist/ui` with Vite. To work on it with hot reload, run `npm run dev` after a build. It serves the app on `http://127.0.0.1:5173`, passing API requests to a `wio ui` server it starts on port 5174, and opens the page signed in to that server's session. It serves `fixtures/`, or another folder with `npm run dev -- <folder>`. The API runs from `dist`, so run `npm run build` again after changing `src/`.

The SSIMULACRA 2 metric is a Rust crate in `wasm/`, compiled to WebAssembly. Its build output, `wasm/pkg`, is committed, so working on `wio` needs no Rust. After changing anything in `wasm/`, start Docker and run `npm run build:wasm`. It builds inside a pinned image with checksummed tools, so the output matches CI's rebuild byte for byte, and CI fails when the committed `wasm/pkg` is out of date. `fixtures/ssimulacra2/` holds six image pairs with scores from libjxl's reference `ssimulacra2` tool, and the tests require the WebAssembly build to stay within 0.5 of each. `node wasm/bench.mjs` times one score at 1 MP and 12 MP.

The encoder settings come from a benchmark, described in [docs/encoding.md](./docs/encoding.md). After `npm run build`, `node scripts/bench-encoders.mjs` reruns it.

Test images live in `fixtures/`, and `fixtures/manifest.json` records each one's traits, source and licence. `node fixtures/generate.mjs` rebuilds the synthetic fixtures and the manifest; add `--photos` to re-download the photos and derive them again. The output bytes vary by platform and libvips version, so run it only when changing a fixture, and review every file it rewrites before committing.

The golden tests in `tests/golden/` run every fixture through every mode and compare what the optimiser decides with `tests/golden/golden.json`, allowing quality within 3 and size within 10%. They take a few minutes, most of it on the four photos, so `npm run test:fast` runs everything else in about 20 seconds. CI runs them on Ubuntu for pull requests that change engine files, and on every OS for release pull requests. A change to `golden.json` is a change to what the tool outputs: after `npm run build`, `node scripts/update-golden.mjs` rewrites it, and the `update-image-engine` skill in `.ai/skills/` covers when and how.

The browser test in `tests/browser/` opens the built UI in Google Chrome through Playwright, runs an image, compares it, moves a quality slider and writes the result. It needs Chrome installed and `npm run build` first. `npm run test:browser` runs it alone, `npm run test:fast` leaves it out, and CI runs it on Ubuntu.

## Licence

MIT. See [LICENSE](./LICENSE). The WebAssembly module includes code under the BSD-2-Clause, MIT and Unicode-3.0 licences, and `wasm/pkg/THIRD-PARTY-NOTICES.txt` lists each crate with its licence. The photos in `fixtures/` are CC0, and `fixtures/manifest.json` credits their authors and sources.
