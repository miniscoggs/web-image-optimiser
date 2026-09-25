// Times one SSIMULACRA 2 score at 1 MP and 12 MP, for the numbers in .ai/design-patterns.md.
// Each pair is the butterfly photo resized, against a WebP q60 round trip of itself.
//   node wasm/bench.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { score } = require("./pkg/ssimulacra2.js");

const PHOTO = fileURLToPath(
  new URL("../fixtures/photo-butterfly.jpg", import.meta.url)
);
const RUNS = 3;
// ~1 MP and ~12 MP at the photo's aspect ratio
const SIZES = [
  { label: "1 MP", width: 1224 },
  { label: "12 MP", width: 4243 },
];

/**
 * Decodes an image into 8-bit RGB pixels.
 *
 * @param input - Encoded image bytes.
 */
async function decodeRgb(input) {
  const { data, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

for (const { label, width } of SIZES) {
  const resized = await sharp(PHOTO).resize({ width }).png().toBuffer();
  const webp = await sharp(resized).webp({ quality: 60 }).toBuffer();
  const reference = await decodeRgb(resized);
  const distorted = await decodeRgb(webp);
  const times = [];

  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    score(reference.data, distorted.data, reference.width, reference.height);
    times.push(performance.now() - start);
  }

  const median = times.toSorted((first, second) => first - second)[
    Math.floor(RUNS / 2)
  ];
  const rss = process.memoryUsage().rss / 2 ** 20;
  console.log(
    `${label} (${reference.width}x${reference.height}): median ${Math.round(median)} ms over ${RUNS} runs, RSS ${Math.round(rss)} MiB`
  );
}
