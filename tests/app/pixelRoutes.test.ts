import { copyFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  diffResponseSchema,
  searchResponseSchema,
} from "../../src/app/api.js";
import { DEFAULT_LANGUAGE, readRights } from "../../src/rights/index.js";
import { fixturePath } from "../fixtureManifest.js";
import { startAppSession } from "./appSession.js";
import type { AppSession } from "./appSession.js";

let session: AppSession;

beforeAll(async () => {
  session = await startAppSession([
    "gradient-16bit.png",
    "logo-alpha.png",
    "icon-6x6.png",
    "text-chunks.png",
    "title-viewbox.svg",
  ]);
});
afterAll(async () => {
  await session.close();
});

/**
 * Searches a file, and parses the response.
 *
 * @param body - The request, with the file's ref.
 */
async function search(body: Record<string, unknown>) {
  const response = await session.post("/api/search", body);

  expect(response.status).toBe(200);
  return searchResponseSchema.parse(await response.json());
}

describe("POST /api/search", () => {
  it("finds the smallest output reaching the target, caching it", async () => {
    const request = {
      file: session.ref("gradient-16bit.png"),
      format: "webp",
      target: "web",
    };
    const found = await search(request);
    const again = await search(request);
    const image = await session.image(found.ref);

    expect(found).toMatchObject({
      ref: expect.stringMatching(
        /^session\/searches\/\d+\/gradient-16bit\.webp$/
      ) as string,
      format: "webp",
      reached: true,
    });
    expect(found.score).toBeGreaterThanOrEqual(70);
    expect(found.saving).toBeGreaterThan(0);
    expect(again).toEqual(found);
    expect(image.headers.get("content-type")).toBe("image/webp");
    expect((await image.arrayBuffer()).byteLength).toBe(found.bytes);
  });

  it("searches again for a new target, a new width or a replaced file", async () => {
    const copy = path.join(session.folder, "replaced.png");

    await copyFile(fixturePath("gradient-16bit.png"), copy);

    const [file] = await session.open(copy);
    const first = await search({ file, format: "webp", target: 70 });
    const higher = await search({ file, format: "webp", target: 85 });
    const narrower = await search({
      file,
      format: "webp",
      target: 70,
      maxWidth: 128,
    });

    await copyFile(fixturePath("text-chunks.png"), copy);

    const replaced = await search({ file, format: "webp", target: 70 });

    expect(higher.ref).not.toBe(first.ref);
    expect(higher.score).toBeGreaterThanOrEqual(85);
    expect(narrower.bytes).toBeLessThan(first.bytes);
    expect(
      await sharp(await session.bytesOf(narrower.ref)).metadata()
    ).toMatchObject({ width: 128, height: 96 });
    expect(replaced.ref).not.toBe(first.ref);
    expect(
      await sharp(await session.bytesOf(replaced.ref)).metadata()
    ).toMatchObject({ width: 320, height: 240 });
  });

  it("gives the best it found, with reached false, when nothing reaches the target", async () => {
    const found = await search({
      file: session.ref("gradient-16bit.png"),
      format: "avif",
      target: 100,
    });

    expect(found).toMatchObject({
      format: "avif",
      method: "lossy",
      reached: false,
    });
    expect(found.score).toBeLessThan(100);
  });

  it("searches a PNG's lossless and palette encodings, and its strip", async () => {
    const found = await search({
      file: session.ref("logo-alpha.png"),
      format: "png",
      target: "high",
    });

    expect(["strip", "lossless", "lossy"]).toContain(found.method);
    expect(found.ref).toMatch(/^session\/searches\/\d+\/logo-alpha\.png$/);
    expect(found.bytes).toBeLessThanOrEqual(4682);
  });

  it("carries the file's rights fields and the ones given, counted in its size, or none with stripAll", async () => {
    const file = session.ref("text-chunks.png");
    const added = await search({
      file,
      format: "webp",
      target: "web",
      rights: { creator: "Someone Else", copyright: "© Example" },
    });
    const stripped = await search({
      file,
      format: "webp",
      target: "web",
      stripAll: true,
    });
    const addedBytes = await session.bytesOf(added.ref);

    expect(addedBytes.byteLength).toBe(added.bytes);
    expect(readRights(addedBytes, "webp")).toEqual({
      creator: ["Fixture Author"],
      copyright: [{ lang: DEFAULT_LANGUAGE, value: "© Example" }],
    });
    expect(added.warnings).toEqual([]);
    expect(stripped.bytes).toBeLessThan(added.bytes);
    expect(readRights(await session.bytesOf(stripped.ref), "webp")).toEqual({});
  });

  it("warns about an image too small to score, whose PNG is lossless", async () => {
    const found = await search({
      file: session.ref("icon-6x6.png"),
      format: "png",
      target: "web",
    });

    expect(found.score).toBe(100);
    expect(found.warnings.map((warning) => warning.code)).toContain(
      "W_TOO_SMALL_TO_SCORE"
    );
  });

  it.each([
    ["an SVG", "title-viewbox.svg", "E_UNSUPPORTED_FORMAT"],
    [
      "a lossy format for an image under 8x8",
      "icon-6x6.png",
      "E_TOO_SMALL_TO_SCORE",
    ],
  ])(
    "refuses %s with 422 and the optimiser's code",
    async (_name, fixture, code) => {
      const response = await session.post("/api/search", {
        file: session.ref(fixture),
        format: "avif",
        target: "web",
      });

      expect(response.status).toBe(422);
      expect(apiErrorSchema.parse(await response.json()).code).toBe(code);
    }
  );

  it.each([
    ["a target over 100", { target: 101 }],
    ["a format with no slider", { format: "svg" }],
    ["an empty rights field", { rights: { credit: "" } }],
    ["a ref in the session folder", { file: "session/searches/1/a.png" }],
  ])("refuses %s with 400", async (_name, change) => {
    const response = await session.post("/api/search", {
      file: session.ref("gradient-16bit.png"),
      format: "webp",
      target: "web",
      ...change,
    });

    expect(response.status).toBe(400);
  });

  it("answers 404 for a file that wasn't opened", async () => {
    const response = await session.post("/api/search", {
      file: "file/99/secret.png",
      format: "webp",
      target: "web",
    });

    expect(response.status).toBe(404);
  });
});

describe("POST /api/diff", () => {
  it("draws a diff map the size of the images, caching it", async () => {
    const original = session.ref("gradient-16bit.png");
    const found = await search({ file: original, format: "jpeg", target: 50 });
    const request = { original, candidate: found.ref };
    const response = await session.post("/api/diff", request);
    const body = diffResponseSchema.parse(await response.json());
    const again = diffResponseSchema.parse(
      await (await session.post("/api/diff", request)).json()
    );
    const image = await session.image(body.ref);
    const metadata = await sharp(await session.bytesOf(body.ref)).metadata();

    expect(response.status).toBe(200);
    expect(body.ref).toMatch(/^session\/diffs\/\d+\/diff\.png$/);
    expect(again).toEqual(body);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(metadata).toMatchObject({ format: "png", width: 256, height: 192 });
  });

  it("shrinks the original to the width a candidate was made at", async () => {
    const original = session.ref("gradient-16bit.png");
    const found = await search({
      file: original,
      format: "webp",
      target: "web",
      maxWidth: 64,
    });
    const shrunk = await session.post("/api/diff", {
      original,
      candidate: found.ref,
      maxWidth: 64,
    });
    const unshrunk = await session.post("/api/diff", {
      original,
      candidate: found.ref,
    });
    const body = diffResponseSchema.parse(await shrunk.json());

    expect(
      await sharp(await session.bytesOf(body.ref)).metadata()
    ).toMatchObject({ width: 64, height: 48 });
    expect(unshrunk.status).toBe(422);
    expect(apiErrorSchema.parse(await unshrunk.json()).code).toBe(
      "E_DIMENSIONS_MISMATCH"
    );
  });

  it("refuses a ref out of the session folder with 400", async () => {
    const response = await session.post("/api/diff", {
      original: session.ref("gradient-16bit.png"),
      candidate: "session/../secret.png",
    });

    expect(response.status).toBe(400);
  });
});
