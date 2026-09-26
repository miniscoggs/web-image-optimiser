import { describe, expect, it } from "vitest";
import {
  avifLossy,
  jpegMozjpeg,
  pngLossless,
  webpLossless,
  webpLossy,
  webpNearLossless,
} from "../../src/encode/index.js";
import type { EncodeResult } from "../../src/encode/index.js";
import { inspect } from "../../src/inspect/index.js";
import { isOpaque } from "../../src/metrics/composite.js";
import { decodeForScoring, score } from "../../src/metrics/index.js";
import type { MetricsImage } from "../../src/metrics/index.js";
import { OptimiserError } from "../../src/schema/index.js";
import { fixturePath } from "../fixtureManifest.js";

// the photos are left out to keep the suite fast; the golden tests cover them
const ROUND_TRIP_FIXTURES = [
  "gradient.png",
  "gradient-16bit.png",
  "logo-alpha.png",
  "semi-transparent.png",
  "icon-6x6.png",
  "orientation-6.jpg",
  "display-p3.jpg",
  "lossless.webp",
  "exif.avif",
];
const ENCODERS: [
  string,
  (source: MetricsImage) => Promise<EncodeResult>,
  EncodeResult["format"],
][] = [
  ["webpLossy", (source) => webpLossy(source, 80), "webp"],
  ["webpLossless", webpLossless, "webp"],
  ["webpNearLossless", (source) => webpNearLossless(source, 60), "webp"],
  ["avifLossy", (source) => avifLossy(source, 60), "avif"],
  ["jpegMozjpeg", (source) => jpegMozjpeg(source, 80), "jpeg"],
  ["pngLossless", pngLossless, "png"],
];
const LOSSLESS = new Set(["webpLossless", "pngLossless"]);

describe("encoders", () => {
  describe.each(ROUND_TRIP_FIXTURES)("round-tripping %s", (file) => {
    it.each(ENCODERS)("%s", async (name, encode, format) => {
      const source = await decodeForScoring(fixturePath(file));
      const result = await encode(source);
      const info = await inspect(result.bytes);
      const decoded = await decodeForScoring(result.bytes);

      expect(result.format).toBe(format);
      expect(info).toMatchObject({
        format,
        width: source.width,
        height: source.height,
        orientation: 1,
        icc: null,
        metadata: [],
      });
      expect(info.hasAlpha).toBe(format !== "jpeg" && !isOpaque(source)); // an unused alpha channel is dropped
      if (LOSSLESS.has(name)) {
        expect(await score(source, decoded)).toBe(100); // lossless webp may change the colour of invisible pixels
      }
    });
  });

  it("records the quality for the encoders that take one", async () => {
    const source = await decodeForScoring(fixturePath("icon-6x6.png"));

    expect(await webpLossy(source, 72)).toMatchObject({
      method: "lossy",
      quality: 72,
    });
    expect(await webpNearLossless(source, 60)).toMatchObject({
      method: "near-lossless",
      quality: 60,
    });
    expect(await webpLossless(source)).not.toHaveProperty("quality");
  });

  it("refuses WebP over 16383 pixels on a side", async () => {
    const wide = {
      data: Buffer.alloc(16384 * 4, 255),
      width: 16384,
      height: 1,
    };

    for (const encode of [
      () => webpLossy(wide, 80),
      () => webpLossless(wide),
      () => webpNearLossless(wide, 60),
    ]) {
      await expect(encode()).rejects.toThrow(OptimiserError);
      await expect(encode()).rejects.toMatchObject({
        code: "E_TOO_LARGE_FOR_FORMAT",
      });
    }
    await expect(pngLossless(wide)).resolves.toMatchObject({ format: "png" });
  });

  it.each([
    ["AVIF over 16384", 16385, (source: MetricsImage) => avifLossy(source, 60)],
    [
      "JPEG over 65500",
      65501,
      (source: MetricsImage) => jpegMozjpeg(source, 80),
    ],
  ])("refuses %s pixels on a side", async (_name, width, encode) => {
    const wide = { data: Buffer.alloc(width * 4, 255), width, height: 1 };

    await expect(encode(wide)).rejects.toThrow(OptimiserError);
    await expect(encode(wide)).rejects.toMatchObject({
      code: "E_TOO_LARGE_FOR_FORMAT",
    });
  });
});
