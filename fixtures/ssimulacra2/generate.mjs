// Builds the SSIMULACRA 2 validation pairs and records libjxl's reference score for each in
// references.json. Needs the `ssimulacra2` tool from a libjxl release:
//   node fixtures/ssimulacra2/generate.mjs <path to ssimulacra2> <libjxl version>
// The WebP bytes vary by platform and libvips version, so run it only to change the pairs, and
// commit the images and scores together.
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import sharp from "sharp";

const PAIR_DIR = new URL("./", import.meta.url);
const QUALITIES = [30, 60, 90];

const [tool, libjxlVersion] = process.argv.slice(2);
if (!tool || !libjxlVersion) {
  console.error(
    "Usage: node fixtures/ssimulacra2/generate.mjs <path to ssimulacra2> <libjxl version>"
  );
  process.exit(2);
}

/**
 * Runs libjxl's ssimulacra2 on two PNG files and returns its score.
 *
 * @param reference - Path of the original PNG.
 * @param distorted - Path of the distorted PNG.
 */
function libjxlScore(reference, distorted) {
  const output = execFileSync(tool, [reference, distorted], {
    encoding: "utf8",
  }).trim();
  const score = Number(output);

  if (output === "" || !Number.isFinite(score)) {
    throw new Error(`Expected a score from ${tool}, got: ${output}`);
  }
  return score;
}

// everything is built and scored in scratch first, so a failure leaves the committed pairs alone
const scratch = await mkdtemp(join(tmpdir(), "wio-ssimulacra2-"));
const inScratch = (file) => join(scratch, file);
const pairs = [];

try {
  // png references decode to the same pixels everywhere
  await sharp(fileURLToPath(new URL("../photo-butterfly.jpg", PAIR_DIR)))
    .resize({ width: 512 })
    .png({ compressionLevel: 9 })
    .toFile(inScratch("butterfly.png"));
  await copyFile(
    fileURLToPath(new URL("../screenshot.png", PAIR_DIR)),
    inScratch("screenshot.png")
  );

  for (const name of ["butterfly", "screenshot"]) {
    for (const quality of QUALITIES) {
      const reference = `${name}.png`;
      const distorted = `${name}-q${quality}.webp`;
      const decoded = inScratch(`${name}-q${quality}.decoded.png`); // libjxl can't read webp

      await sharp(inScratch(reference))
        .webp({ quality })
        .toFile(inScratch(distorted));
      await sharp(inScratch(distorted)).png().toFile(decoded);

      const score = libjxlScore(inScratch(reference), decoded);
      pairs.push({ reference, distorted, quality, score });
      console.log(`${distorted}: ${score}`);
    }
  }

  const images = [
    ...new Set(pairs.flatMap((pair) => [pair.reference, pair.distorted])),
  ];
  for (const image of images) {
    await copyFile(inScratch(image), fileURLToPath(new URL(image, PAIR_DIR)));
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

const referencesFile = new URL("references.json", PAIR_DIR);
const prettierConfig = await resolveConfig(referencesFile);
const references = await format(
  JSON.stringify({
    tool: `libjxl ${libjxlVersion} ssimulacra2`,
    sources: {
      "butterfly.png":
        "fixtures/photo-butterfly.jpg resized to 512 px wide (CC0-1.0)",
      "screenshot.png": "copy of fixtures/screenshot.png (MIT)",
    },
    pairs,
  }),
  { ...prettierConfig, parser: "json" }
);
await writeFile(referencesFile, references);
