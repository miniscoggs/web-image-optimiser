import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareFiles } from "../../src/compare/index.js";
import type { CompareResult } from "../../src/compare/index.js";
import { compareResultSchema } from "../../src/schema/contract.js";
import { fixturePath } from "../fixtureManifest.js";

const PAIR_DIR = new URL("../../fixtures/ssimulacra2/", import.meta.url);
const ORIGINAL = fileURLToPath(new URL("butterfly.png", PAIR_DIR));
const CANDIDATE = fileURLToPath(new URL("butterfly-q60.webp", PAIR_DIR));

let folder = "";

/**
 * Checks a result against the JSON contract, which parsing would strip of any field it lacks.
 *
 * @param result - The comparison's result.
 */
function expectContract(result: CompareResult) {
  expect(compareResultSchema.parse(result)).toEqual(result);
}

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "wio compare é-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("compareFiles", () => {
  it("scores a candidate against its original and reports the saving", async () => {
    const result = await compareFiles(ORIGINAL, CANDIDATE);

    expectContract(result);
    expect(result).toMatchObject({
      original: { path: ORIGINAL, format: "png", width: 512, height: 347 },
      candidate: { path: CANDIDATE, format: "webp", width: 512, height: 347 },
      verdict: "noticeable",
      warnings: [],
    });
    expect(result.score).toBeCloseTo(68.08, 0); // libjxl's reference score for this pair
    expect(result.saving).toBeCloseTo(
      1 - (result.candidate.bytes ?? 0) / (result.original.bytes ?? 1)
    );
    expect(result.error).toBeUndefined();
  });

  it("scores an image against itself as 100", async () => {
    const result = await compareFiles(ORIGINAL, ORIGINAL);

    expect(result).toMatchObject({
      score: 100,
      verdict: "visually-lossless",
      saving: 0,
    });
  });

  it("writes a diff map the size of the images", async () => {
    const diff = path.join(folder, "diff.png");
    const result = await compareFiles(ORIGINAL, CANDIDATE, { diff });
    const metadata = await sharp(diff).metadata();

    expect(result.diff).toBe(diff);
    expect(metadata).toMatchObject({ format: "png", width: 512, height: 347 });
  });

  it("leaves an existing file alone without overwrite, and replaces it with", async () => {
    const diff = path.join(folder, "diff.png");

    await writeFile(diff, "keep me");

    const kept = await compareFiles(ORIGINAL, CANDIDATE, { diff });

    expectContract(kept);
    expect(kept.diff).toBeUndefined();
    expect(kept.score).toBeCloseTo(68.08, 0);
    expect(kept.warnings.map((warning) => warning.code)).toEqual([
      "W_OUTPUT_EXISTS",
    ]);
    expect(await readFile(diff, "utf8")).toBe("keep me");

    const replaced = await compareFiles(ORIGINAL, CANDIDATE, {
      diff,
      overwrite: true,
    });

    expect(replaced.diff).toBe(diff);
    expect(replaced.warnings).toEqual([]);
    expect((await sharp(diff).metadata()).format).toBe("png");
  });

  it("never writes the diff map over either image", async () => {
    const original = path.join(folder, "original.png");

    await copyFile(ORIGINAL, original);

    const before = await readFile(original);
    const result = await compareFiles(original, CANDIDATE, {
      diff: original,
      overwrite: true,
    });

    expectContract(result);
    expect(result.error?.code).toBe("E_OUTPUT_IS_INPUT");
    expect(result.score).toBeUndefined();
    expect(await readFile(original)).toEqual(before);
  });

  it("fails with E_DIMENSIONS_MISMATCH, describing both images", async () => {
    const result = await compareFiles(ORIGINAL, fixturePath("logo-alpha.png"));

    expectContract(result);
    expect(result).toMatchObject({
      original: { width: 512, height: 347 },
      candidate: { width: 320, height: 160 },
      error: { code: "E_DIMENSIONS_MISMATCH" },
    });
    expect(result.error?.message).toContain("512x347 and 320x160");
  });

  it("fails with E_UNSUPPORTED_FORMAT for an SVG", async () => {
    const svg = fixturePath("title-viewbox.svg");
    const result = await compareFiles(svg, ORIGINAL);

    expectContract(result);
    expect(result).toMatchObject({
      original: { path: svg, format: "svg" },
      error: { code: "E_UNSUPPORTED_FORMAT" },
    });
    expect(result.error?.message).toContain(svg);
  });

  it("fails with E_READ naming the missing file", async () => {
    const missing = path.join(folder, "missing.webp");
    const result = await compareFiles(ORIGINAL, missing);

    expectContract(result);
    expect(result).toMatchObject({
      original: { format: "png" },
      candidate: { path: missing },
      error: { code: "E_READ" },
    });
    expect(result.error?.message.startsWith(`${missing}: `)).toBe(true);
  });

  it("scores identical tiny images, and fails differing ones with E_TOO_SMALL_TO_SCORE", async () => {
    const icon = fixturePath("icon-6x6.png");
    const changed = path.join(folder, "changed.png");

    await sharp(icon).negate({ alpha: false }).png().toFile(changed);

    expect((await compareFiles(icon, icon)).score).toBe(100);

    const result = await compareFiles(icon, changed);

    expectContract(result);
    expect(result.error?.code).toBe("E_TOO_SMALL_TO_SCORE");
  });

  it("refuses a diff map path that isn't a PNG", async () => {
    await expect(
      compareFiles(ORIGINAL, CANDIDATE, { diff: "diff.jpg" })
    ).rejects.toThrow(RangeError);
  });

  it("rejects when aborted", async () => {
    await expect(
      compareFiles(ORIGINAL, CANDIDATE, {}, { signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
