import { assert, describe, expect, it, vi } from "vitest";
import type { MetricsImage } from "../../src/metrics/index.js";

type WasmCall = [Buffer, Buffer, number, number];

const scoreSsimulacra2 = vi.fn<(...call: WasmCall) => number>(() => 75); // the real scorer would take ~30 s here

vi.doMock("../../src/metrics/ssimulacra2.js", () => ({
  default: scoreSsimulacra2,
}));

const { isDownscaledForScoring, score } =
  await import("../../src/metrics/index.js");

/**
 * Builds an opaque grey RGBA image, with the first pixel brightened when `marked`.
 *
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param marked - Whether to brighten the first pixel, so two images differ.
 */
function greyImage(width: number, height: number, marked: boolean) {
  const data = Buffer.alloc(width * height * 4, 128);

  data[0] = marked ? 255 : 128;
  return { data, width, height } satisfies MetricsImage;
}

describe("score with images too large for the scorer", () => {
  it(
    "resizes both to at most 26 MP, keeping the aspect ratio",
    {
      timeout: 30_000, // real flatten and resize of 32 MP; ~6 s on the intel mac runner
    },
    async () => {
      const reference = greyImage(8000, 4000, false); // 32 MP
      const distorted = greyImage(8000, 4000, true);

      expect(isDownscaledForScoring(reference)).toBe(true);
      await expect(score(reference, distorted)).resolves.toBe(75);

      const call = scoreSsimulacra2.mock.calls[0];

      assert(call, "the wasm scorer was not called");
      const [scoredReference, scoredDistorted, width, height] = call;

      expect(width * height).toBeLessThanOrEqual(26_000_000);
      expect(width * height).toBeGreaterThan(25_900_000);
      expect(width / height).toBeCloseTo(2, 2);
      expect(scoredReference.length).toBe(width * height * 3);
      expect(scoredDistorted.length).toBe(width * height * 3);
    }
  );
});
