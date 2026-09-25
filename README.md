# web-image-optimiser

Prepares images for websites. `wio` reads PNG, JPEG, WebP, AVIF and SVG files, always strips metadata, and writes the smallest output that stays above a perceptual quality target (SSIMULACRA 2), with a plain-language verdict when degradation would be noticeable.

> **Status:** in development. The package is not published to npm yet, and the CLI has no commands yet.

## Development

Requires Node.js 24 or later.

```sh
npm install
npm run build
npm run lint
npm test
```

Test images live in `fixtures/`, and `fixtures/manifest.json` records each one's traits, source and licence. `node fixtures/generate.mjs` rebuilds the synthetic fixtures and the manifest; add `--photos` to re-download the photos and derive them again. The output bytes vary by platform and libvips version, so run it only when changing a fixture, and review every file it rewrites before committing.

## Licence

MIT. See [LICENSE](./LICENSE). The photos in `fixtures/` are CC0, and `fixtures/manifest.json` credits their authors and sources.
