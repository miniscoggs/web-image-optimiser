import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixturePath } from "../fixtureManifest.js";

const beforeRead: { save?: () => Promise<void> } = {}; // lands a save just before the next read

vi.doMock("../../src/pipeline/readInput.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/pipeline/readInput.js")>();

  return {
    default: async (filePath: string) => {
      const { save } = beforeRead;

      delete beforeRead.save;
      await save?.();
      return actual.default(filePath);
    },
  };
});

const { runPixelJob } = await import("../../src/app/pixelJobs.js");

let folder = "";

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "wio pixel jobs-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

/**
 * Searches a file's WebP at the web target, and returns the reply with the output's width.
 *
 * @param source - The file.
 * @param maxWidth - The maximum width, if any.
 */
async function searchWebp(source: string, maxWidth?: number) {
  const output = path.join(folder, `out-${maxWidth ?? "full"}.webp`);
  const reply = await runPixelJob({
    type: "search",
    source,
    format: "webp",
    settings: { target: 70, maxWidth, stripAll: false },
    output,
  });
  const { width } = await sharp(await readFile(output)).metadata();

  return { reply, width };
}

describe("runPixelJob's searches", () => {
  it("search a file again once a save replaces it, rather than reuse the old version's", async () => {
    const source = path.join(folder, "image.png");

    await copyFile(fixturePath("text-chunks.png"), source);

    const before = await searchWebp(source);

    await copyFile(fixturePath("screenshot.png"), source);

    const after = await searchWebp(source);
    const { size } = await stat(source);

    expect(before.width).toBe(320);
    expect(after.width).toBe(800);
    expect(after.reply).toMatchObject({ type: "searched", inputBytes: size });
  });

  it("search afresh when a save lands as the file is read", async () => {
    const source = path.join(folder, "image.png");

    await copyFile(fixturePath("text-chunks.png"), source);
    await searchWebp(source);
    beforeRead.save = () => copyFile(fixturePath("screenshot.png"), source);

    const after = await searchWebp(source);

    expect(after.width).toBe(800); // the new file's, not the first version's kept pixels
  });

  it("keep a file's searches at each maximum width apart", async () => {
    const source = fixturePath("screenshot.png");
    const full = await searchWebp(source);
    const narrow = await searchWebp(source, 400);
    const fullAgain = await searchWebp(source);

    expect([full.width, narrow.width, fullAgain.width]).toEqual([
      800, 400, 800,
    ]);
    expect(fullAgain.reply).toEqual(full.reply);
  });
});
