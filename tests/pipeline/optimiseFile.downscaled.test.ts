import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fixturePath } from "../fixtureManifest.js";

vi.doMock("../../src/metrics/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/metrics/index.js")>()),
  isDownscaledForScoring: () => true, // as for an image over 26 MP
}));

const { optimiseFile } = await import("../../src/pipeline/index.js");

describe("optimiseFile on an image too large to score at full size", () => {
  it("warns with W_SCORED_DOWNSCALED", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "wio-downscaled-"));

    try {
      const result = await optimiseFile(fixturePath("gradient.png"), {
        to: "same",
        outDir,
        dryRun: true,
      });

      expect(result.warnings.map((warning) => warning.code)).toEqual([
        "W_SCORED_DOWNSCALED",
      ]);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
