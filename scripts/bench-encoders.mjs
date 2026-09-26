// Compares encoder settings by the bytes each needs to reach a target score. Run `npm run build`
// first. Usage: node scripts/bench-encoders.mjs [--target 80]
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { QUALITY_RANGES } from "../dist/encode/index.js";
import { isOpaque } from "../dist/metrics/composite.js";
import { decodeForScoring, score } from "../dist/metrics/index.js";
import { searchQuality } from "../dist/search/index.js";

const IMAGES = [
  "photo-butterfly.jpg",
  "photo-night-bridge.jpg",
  "photo-rhino.jpg",
  "photo-sunset.jpg",
  "screenshot.png",
  "gradient.png",
  "logo-alpha.png",
  "semi-transparent.png",
];
const CONFIGS = {
  "avif auto e4": {
    format: "avif",
    range: QUALITY_RANGES.avif,
    options: { tune: "auto", effort: 4 },
  },
  "avif iq e4": {
    format: "avif",
    range: QUALITY_RANGES.avif,
    options: { tune: "iq", effort: 4 },
  },
  "avif auto e6": {
    format: "avif",
    range: QUALITY_RANGES.avif,
    options: { tune: "auto", effort: 6 },
  },
  "avif iq e6": {
    format: "avif",
    range: QUALITY_RANGES.avif,
    options: { tune: "iq", effort: 6 },
  },
  "webp deblock off": {
    format: "webp",
    range: QUALITY_RANGES.webp,
    options: {
      effort: 6,
      alphaQuality: 100,
      smartSubsample: true,
      smartDeblock: false,
    },
  },
  "webp deblock on": {
    format: "webp",
    range: QUALITY_RANGES.webp,
    options: {
      effort: 6,
      alphaQuality: 100,
      smartSubsample: true,
      smartDeblock: true,
    },
  },
};
const FIXTURE_DIR = new URL("../fixtures/", import.meta.url);

const targetIndex = process.argv.indexOf("--target");
const target = targetIndex === -1 ? 80 : Number(process.argv[targetIndex + 1]);
const configName = process.env.BENCH_CONFIG;

/**
 * Encodes decoded pixels the way src/encode does, with the settings under test.
 *
 * @param source - The decoded image.
 * @param config - The format and sharp options.
 * @param quality - The quality.
 */
async function encode(source, config, quality) {
  const raw = { width: source.width, height: source.height, channels: 4 };
  const pipeline = sharp(source.data, { raw });
  const started = performance.now();
  const bytes = await (isOpaque(source) ? pipeline.removeAlpha() : pipeline)
    .toFormat(config.format, { ...config.options, quality })
    .toBuffer();
  return { bytes, milliseconds: performance.now() - started };
}

/**
 * Runs one configuration over every image and sends the results to the parent process.
 *
 * @param name - A key of CONFIGS.
 */
async function runConfig(name) {
  const config = CONFIGS[name];
  const results = [];
  sharp.concurrency(1); // as optimiseFile sets it, since avif output depends on the thread count
  for (const file of IMAGES) {
    const source = await decodeForScoring(
      fileURLToPath(new URL(file, FIXTURE_DIR))
    );
    let encodeMilliseconds = 0;
    const result = await searchQuality({
      encode: async (quality) => {
        const candidate = await encode(source, config, quality);
        encodeMilliseconds += candidate.milliseconds;
        return candidate;
      },
      score: async (candidate) =>
        score(source, await decodeForScoring(candidate.bytes)),
      target,
      range: config.range,
    });
    results.push({
      file,
      quality: result.chosen.quality,
      bytes: result.chosen.candidate.bytes.length,
      score: result.chosen.score,
      reached: result.reached,
      encodeMilliseconds,
      attempts: result.attempts.length,
    });
  }
  process.send({ name, results });
}

/**
 * Runs every configuration in its own process, as scoring blocks its thread, and prints a table.
 */
async function main() {
  const script = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Object.keys(CONFIGS).map(
      (name) =>
        new Promise((resolve, reject) => {
          const child = fork(script, process.argv.slice(2), {
            env: { ...process.env, BENCH_CONFIG: name },
          });
          child.on("message", resolve);
          child.on("error", reject);
        })
    )
  );
  console.log(`target ${target}`);
  console.log(["config", ...IMAGES, "total bytes", "encode s"].join("\t"));
  for (const { name, results } of runs) {
    const cells = results.map(
      (result) =>
        `${result.bytes} q${result.quality} ${result.score.toFixed(1)}${result.reached ? "" : "!"}`
    );
    const total = results.reduce((sum, result) => sum + result.bytes, 0);
    const seconds =
      results.reduce((sum, result) => sum + result.encodeMilliseconds, 0) /
      1000;
    console.log([name, ...cells, total, seconds.toFixed(1)].join("\t"));
  }
}

if (configName) {
  await runConfig(configName);
} else {
  await main();
}
