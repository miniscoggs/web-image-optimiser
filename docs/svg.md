# SVG optimisation

SVGs always stay SVG: `wio` never turns one into a raster image. They are optimised with [SVGO](https://github.com/svg/svgo), and every result is checked by rendering it.

## What happens to an SVG

1. SVGO runs with its default preset and `multipass`, with three changes that keep the SVG safe to use in a page:
   - IDs are never renamed or removed from drawn elements (`cleanupIds` and `inlineStyles` are off), because page CSS, scripts and `<use>` in other files may refer to them. Classes are kept for the same reason.
   - `<desc>` and `role` attributes are kept, along with `<title>` and `aria-*` attributes, so icons keep their accessible names.
   - `viewBox` is always kept, so the SVG still scales.
2. SVGO rounds numbers to a number of decimal places, its float precision. `wio` tries 2, 3, 4 and 5 places in turn and keeps the lowest that still looks the same.
3. To check that, the original and the optimised SVG are rendered at 1x and 2x, with the short side at least 64 pixels, and compared with SSIMULACRA 2. Both renders must score at least 90 (visually lossless), whatever quality target was asked for.
4. If no precision passes, `wio` falls back to a metadata-only pass (below), which doesn't change anything that renders.

Comments, `<metadata>` and editor data from Inkscape, Illustrator, Sketch, Figma and similar tools are removed in both cases. Comments written as `<!--! ... -->`, the convention for licence notices, are kept.

The result reports its size and its gzipped size. Servers usually send SVG compressed with gzip or Brotli, so the gzipped size is closer to what visitors download.

## The metadata-only pass

The metadata-only pass runs just SVGO's `removeComments`, `removeMetadata` and `removeEditorsNSData` plugins. It is SVG's lossless strip: when optimising doesn't make a file smaller, this is what `wio` writes instead, so the metadata is still removed.

## What the render check can't see

The check renders with librsvg, the renderer inside sharp, so it only sees what a static render shows:

- **Scripts** don't run, so anything they draw or change isn't checked.
- **Animation** (SMIL or CSS) is only seen at its first frame.
- **Browser-only features** such as `:hover` styles, media queries, `prefers-color-scheme`, web fonts and external images aren't rendered as a browser would.
- **Hidden elements** (for example `display: none`) are removed by SVGO. If a script or page CSS shows them later, they will be missing.
- **Tiny coordinate systems**, with a `viewBox` narrower than about 0.001 units, render as blank in librsvg, so a broken result can pass.

Numbers inside `style` attributes aren't rounded, because SVGO only rounds geometry and presentation attributes.
