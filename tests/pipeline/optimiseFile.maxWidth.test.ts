import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspect } from "../../src/inspect/index.js";
import { isOpaque } from "../../src/metrics/composite.js";
import { decodeForScoring, score } from "../../src/metrics/index.js";
import { PIPELINE_MODES, optimiseFile } from "../../src/pipeline/index.js";
import type { PipelineFileResult } from "../../src/pipeline/index.js";
import { fixturePath } from "../fixtureManifest.js";

let folder = "";

/**
 * Returns a result's warning codes.
 *
 * @param result - The file's result.
 */
function warningCodes(result: PipelineFileResult) {
  return result.warnings.map((warning) => warning.code);
}

/**
 * Writes a PNG into the test folder from 8-bit pixels.
 *
 * @param name - The file's name.
 * @param raw - The pixels' size and channels.
 * @param pixel - Returns a channel's value at a position in the pixel data.
 */
async function writePng(
  name: string,
  raw: { width: number; height: number; channels: 1 | 3 },
  pixel: (index: number, x: number, y: number) => number
) {
  const data = Buffer.alloc(raw.width * raw.height * raw.channels);

  for (let index = 0; index < data.length; index++) {
    const position = Math.floor(index / raw.channels);

    data[index] = pixel(
      index,
      position % raw.width,
      Math.floor(position / raw.width)
    );
  }

  const input = path.join(folder, name);
  const png = await sharp(data, { raw })
    .png({ palette: raw.channels === 1, compressionLevel: 9 })
    .toBuffer();

  await writeFile(input, png);
  return input;
}

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "wio max width-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("optimiseFile with maxWidth", () => {
  it.each(PIPELINE_MODES)(
    "shrinks a wider photo to the cap in %s mode, scoring against the shrunk source",
    async (to) => {
      const input = fixturePath("photo-sunset.jpg");
      const outDir = path.join(folder, "out");
      const result = await optimiseFile(input, { to, maxWidth: 240, outDir });
      const decoded = await decodeForScoring(input);
      const source = {
        data: await sharp(decoded.data, {
          raw: { width: 1600, height: 912, channels: 4 },
        })
          .resize(240, 137, { fit: "fill" }) // 912 * 240 / 1600 = 136.8
          .raw()
          .toBuffer(),
        width: 240,
        height: 137,
      };

      expect(result).toMatchObject({
        status: "optimised",
        width: 1600,
        height: 912,
      });
      expect(result.outputs.length).toBeGreaterThan(0);
      for (const output of result.outputs) {
        const written = await readFile(output.path);

        expect(output).toMatchObject({ width: 240, height: 137 });
        expect(output.method).not.toBe("strip");
        expect(await inspect(written)).toMatchObject({
          width: 240,
          height: 137,
        });
        expect(await score(source, await decodeForScoring(written))).toBe(
          output.score
        );
      }
    }
  );

  it("leaves a raster image at the cap, and an SVG, as they are", async () => {
    const png = fixturePath("text-chunks.png");
    const svg = fixturePath("editor-metadata.svg");
    const outDir = path.join(folder, "out");
    const options = { to: "same", outDir, dryRun: true } as const;

    expect(await optimiseFile(png, { ...options, maxWidth: 320 })).toEqual(
      await optimiseFile(png, options)
    );
    expect(await optimiseFile(svg, { ...options, maxWidth: 100 })).toEqual(
      await optimiseFile(svg, options)
    );
    expect((await optimiseFile(svg, options)).outputs[0]).toMatchObject({
      width: 240,
      height: 160,
    });
  });

  it("caps the displayed width of a rotated photo", async () => {
    const outDir = path.join(folder, "out");
    const result = await optimiseFile(fixturePath("orientation-6.jpg"), {
      maxWidth: 160,
      outDir,
    });
    const [output] = result.outputs;

    expect(output).toMatchObject({ width: 160, height: 240 });
    expect(await inspect(await readFile(output?.path ?? ""))).toMatchObject({
      width: 160,
      height: 240,
    });
  });

  it("keeps transparency through a resize", async () => {
    const outDir = path.join(folder, "out");
    const result = await optimiseFile(fixturePath("logo-alpha.png"), {
      maxWidth: 160,
      outDir,
    });
    const written = await readFile(result.outputs[0]?.path ?? "");

    expect(result.outputs[0]).toMatchObject({ width: 160, height: 80 });
    expect(isOpaque(await decodeForScoring(written))).toBe(false);
  });

  it("falls back to the input's own format at the new width when converting", async () => {
    const input = await writePng(
      "noise.png",
      { width: 64, height: 8, channels: 3 },
      (index) => (index * 2_654_435_761) >>> 24
    );
    const result = await optimiseFile(input, {
      to: "avif",
      maxWidth: 32,
      outDir: path.join(folder, "out"),
      dryRun: true,
    }); // 32x4 is too small to score, so no avif is tried

    expect(result).toMatchObject({
      status: "optimised",
      outputs: [
        {
          role: "same",
          format: "png",
          method: "lossless",
          width: 32,
          height: 4,
        },
      ],
    });
    expect(warningCodes(result)).toEqual([
      "W_TOO_SMALL_TO_SCORE",
      "W_NOT_CONVERTED",
      "W_NO_RIGHTS",
    ]);
  });

  it.each([
    ["same", ["W_NOT_RESIZED", "W_NO_RIGHTS"]],
    ["webp", ["W_NOT_CONVERTED", "W_NOT_RESIZED", "W_NO_RIGHTS"]],
    ["suite", ["W_NOT_RESIZED", "W_NO_RIGHTS"]],
  ] as const)(
    "keeps the original with W_NOT_RESIZED in %s mode when nothing at the new width is smaller",
    async (to, codes) => {
      const input = await writePng(
        "checkerboard.png",
        { width: 128, height: 128, channels: 1 },
        (_index, x, y) => ((x + y) % 2) * 255
      ); // 193 bytes, which a shrink turns into moire
      const outDir = path.join(folder, "out");
      const result = await optimiseFile(input, { to, maxWidth: 127, outDir });

      expect(result).toMatchObject({ status: "kept-original", outputs: [] });
      expect(warningCodes(result)).toEqual(codes);
      expect(await readdir(folder)).toEqual(["checkerboard.png"]);
    }
  );

  it("rejects a maximum width that isn't a whole number of at least 1", async () => {
    const input = fixturePath("icon-6x6.png");

    for (const maxWidth of [0, 1.5, Number.NaN]) {
      await expect(optimiseFile(input, { maxWidth })).rejects.toThrow(
        RangeError
      );
    }
  });
});
