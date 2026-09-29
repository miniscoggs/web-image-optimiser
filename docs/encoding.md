# Encoding

`wio` encodes with sharp (libvips). There are no effort or tuning flags: every setting below is fixed, and the ones that were in doubt were chosen with a benchmark.

## Encoders

Every encoder starts from the same decoded source: 8-bit sRGB pixels with the orientation applied, which are also the pixels each candidate is scored against. Encodes carry no metadata and no colour profile, until the pipeline writes in the rights fields ([modes.md](./modes.md#metadata)). An alpha channel is kept only when some pixel is actually transparent.

| Encoder | Settings | Qualities searched |
| --- | --- | --- |
| WebP lossy | effort 6, smart chroma subsampling, alpha at full quality, smart deblocking | 30–95 |
| WebP lossless | effort 6, quality 100 (see Lossless WebP below) | — |
| WebP near-lossless | effort 6; the quality is the near-lossless level | — |
| AVIF | effort 6, `tune: iq`, 4:4:4 chroma | 20–90 |
| JPEG | mozjpeg: progressive, trellis quantisation, optimised Huffman tables | 40–95 |
| PNG lossless | zlib level 9, adaptive filtering | — |
| PNG palette | libimagequant effort 7, dithering 1.0, zlib level 9 | 1–100 |

A 16-bit source is reduced to 8 bits before encoding, so PNG output is 8-bit. The score shows whether that reduction is visible. WebP can't store an image wider or taller than 16383 pixels, AVIF (through sharp) 16384 pixels, or JPEG 65500 pixels, so such images get no candidate in that format.

### Lossless WebP

In lossless mode, libwebp reads the quality as how hard to compress, not as image quality: every setting decodes to the same pixels. sharp's default is 80, and `wio` passes 100, the hardest. Bytes for the lossless WebP of each graphic fixture at effort 6, from its decoded 8-bit pixels, with sharp 0.35.4 (libwebp 1.6.0):

| Fixture | Quality 80 | **Quality 100** |
| --- | --- | --- |
| `screenshot.png` | 21,632 | **20,670** |
| `text-chunks.png` | 76,926 | **75,454** |
| `logo-alpha.png` | 2,852 | **2,770** |
| `semi-transparent.png` | 6,454 | **6,290** |
| `gradient.png` | 1,230 | **152** |
| `gradient-16bit.png` | 71,106 | **710** |
| `icon-6x6.png` | 72 | **54** |
| `lossless.webp` | **2,810** | 2,824 |

Quality 100 was smaller on every fixture but one, by up to 99% on the gradients, and 14 bytes larger on `lossless.webp`. Near-lossless WebP can't be tuned the same way, because libvips uses its one quality as both the near-lossless level and the effort.

## Quality search

For each lossy encoder, `wio` looks for the lowest quality whose output scores at least the target. It tries the highest quality in the range first, and stops there if even that falls short. Otherwise it binary-searches the range, assuming the score rises with quality, then tries one step above the result, because encoders don't follow that rule exactly. The smallest passing attempt wins. A search takes about eight encodes, and scoring each one takes about a second per megapixel.

## Benchmark

`node scripts/bench-encoders.mjs --target <score>` (after `npm run build`) runs the quality search for each setting on eight fixtures. These are four 1600-pixel photos, a text screenshot, a gradient, a logo with transparency and a semi-transparent graphic. It reports the bytes each setting needs to reach the target. Re-run it after upgrading sharp.

Results with sharp 0.35.4 (libvips 8.18.6, libaom 3.14.1, libwebp 1.6.0) on an i9-10850K, with libvips on one thread as `wio` runs it (see Threads below). Encode time is the total over all eight searches:

| Setting | Bytes at 80 | Encode time | Bytes at 90 | Encode time |
| --- | --- | --- | --- | --- |
| AVIF effort 4, `tune: auto` | 487,631 | 127.3 s | 870,786 | 123.4 s |
| AVIF effort 4, `tune: iq` | 487,617 | 127.1 s | 870,705 | 124.1 s |
| AVIF effort 6, `tune: auto` | 470,274 | 341.5 s | 833,590 | 333.3 s |
| **AVIF effort 6, `tune: iq`** | **470,358** | 343.7 s | **833,631** | 333.9 s |
| WebP without smart deblocking | 696,622 | 23.9 s | 1,251,576 | 15.5 s |
| **WebP with smart deblocking** | **686,556** | 40.4 s | **1,250,678** | 18.3 s |

- **AVIF tune:** `auto` and `iq` gave byte-identical files for every opaque image, so libheif's automatic choice is already `iq` for colour. They differed only slightly, either way, on the two transparent images. `iq` is set explicitly so the output doesn't change if libheif's default does.
- **AVIF effort:** effort 6 needs 3.5% fewer bytes at target 80 and 4.3% fewer at 90 (12% on the screenshot at 80, and 25% on the gradient at 90), for about 2.7 times the encode time. Two tiny images came out 20 to 30 bytes larger. Effort 4 is the faster alternative if speed matters more.
- **WebP deblocking:** smart deblocking was never larger. It saved 1.4% at target 80 (4.7% on the sunset's smooth sky) and 9–18% on the logo, for up to 1.7 times the encode time.

### Palette PNG

`node scripts/bench-encoders.mjs --target <score> --only "png palette"` runs the palette settings alone, on five graphics: the screenshot, a screenshot with text chunks, the gradient, the logo and the semi-transparent graphic. A photo's palette encode fails at the top quality, so photos can't tell the settings apart. Bytes are totals over the images that reach the target with every setting (the screenshots and the logo), with the semi-transparent graphic added where it reaches 80:

| Setting | Bytes at 80 | With the semi-transparent graphic | Bytes at 90 |
| --- | --- | --- | --- |
| Effort 7, no dithering | 44,138 | doesn't reach 80 | 58,356 |
| **Effort 7, dithering 1.0** | **42,568** | **56,995** | **58,003** |
| Effort 10, no dithering | 43,462 | doesn't reach 80 | 58,514 |
| Effort 10, dithering 1.0 | 42,871 | 56,833 | 58,332 |

- **Dithering** is smaller at both targets, and only with it does the semi-transparent graphic reach 80 (at 14.4 kB, larger than its lossless PNG of 8.7 kB, which still wins).
- **Effort:** 10 was 162 bytes smaller at 80 and 329 larger at 90, so effort 7, which is also faster (2.2 s against 3.7 s for the five searches at 80), is 167 bytes smaller over both. Both settings match sharp's palette defaults, and are set explicitly so the output doesn't change if sharp's do.
- **The gradients never reach 80** as a palette: 256 colours band a smooth gradient, and dithering only raises the score to 68.
- **The floor is 1:** the logo passes at quality 1 or 2, so the search keeps the whole range.

## Threads

libvips gives libaom as many threads as its own thread count, and libaom then splits an AVIF into tiles to use them. Tiles compress less well, so at the same target the files are larger, and their bytes depend on how many CPUs the machine has. `wio` therefore runs libvips on one thread (`sharp.concurrency(1)`), and gets its parallelism from optimising several files at once, each in a child process of its own, instead.

The same benchmark at libvips' default of 20 threads on this machine needed 485,703 bytes for AVIF at effort 6 at target 80 (3.2% more), and 840,630 at 90 (0.8% more). Small images suffered most: the gradient's AVIF at quality 22 was 1,020 bytes at 20 threads and 659 at one. Encoding took about a fifth of the time: 68.6 s instead of 343.7 s. WebP, JPEG and PNG, palette included, come out byte-identical whatever the thread count.

## Limits the benchmark showed

- **Lossy WebP rarely reaches 90.** WebP always halves colour resolution (4:2:0 chroma subsampling), so at quality 95 the photos and the screenshot scored only 84.8–87.9. At the `visually-lossless` target, expect a WebP to miss the target, or to lose to AVIF or a lossless format.
- **AVIF tops out just below 90 on text.** The screenshot reached 89.6 at quality 90, the top of AVIF's range.
- **WebP effort 6 is slow on transparency.** It searches much harder for the best way to compress an alpha channel. On a 320x160 logo that made each encode take 0.58 s instead of 0.03 s at effort 5, for 2 bytes. On a 1.7 MP photo with a soft transparent edge it took 4.7 s instead of 1.2 s, but the file was 27% smaller, so effort 6 stays.
- **Some images pass at the bottom of the range.** The semi-transparent graphic scored 90.9 as WebP at quality 30, the lowest quality searched, so a lower floor could make it smaller still.
