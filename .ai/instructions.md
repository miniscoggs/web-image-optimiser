# Instructions

web-image-optimiser (command `wio`) prepares images for websites. It reads PNG, JPEG, WebP, AVIF and SVG, always strips metadata, and writes the smallest output that stays above an SSIMULACRA 2 quality target. It ships as one npm package with no external binaries, and must behave the same on Windows and macOS.

## Working in this repo

- Check `.ai/skills.md` first and follow a matching project skill over a general approach.
- Question unusual or counter-intuitive logic before implementing it, and record a deliberate decision with a short comment.
- If a request conflicts with these docs, say so before proceeding and offer to follow the convention.
- After a change, review it for simplicity, then update `README.md`, `docs/*.md` and `.ai/` in the same change so no doc describes behaviour the code doesn't have.
- When sharp, SVGO or another dependency falls short, prefer fixing or reporting it upstream. Keep any local workaround small, with a comment linking the upstream issue.
- Follow only this repo's steering, not that of other projects open alongside it.

## Commands

| Command                      | Purpose                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run build`              | Compile `src/` into `dist/`                                                                              |
| `npm run lint`               | ESLint, then a Prettier check                                                                            |
| `npm run lint:fix`           | ESLint and Prettier with fixes applied                                                                   |
| `npm test`                   | Vitest, then a type-check of `src/` and `tests/`                                                         |
| `node fixtures/generate.mjs` | Rebuild the synthetic fixtures and `manifest.json`; `--photos` also re-derives the photos. Run it only to change a fixture, and review every changed file |
