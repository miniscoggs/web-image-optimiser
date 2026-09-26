import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  encodeResponseSchema,
  uploadResponseSchema,
  writeResponseSchema,
} from "../../src/server/api.js";
import { fixturePath } from "../fixtureManifest.js";
import { findSessionFolder, startUiSession, writeText } from "./uiSession.js";
import type { UiSession } from "./uiSession.js";

const GRADIENT = "root/gradient-16bit.png";

let session: UiSession;
let sessionFolder = "";

/**
 * Re-encodes a file through the API.
 *
 * @param file - The file's ref.
 * @param format - The format.
 * @param quality - The quality.
 */
async function encode(file: string, format: string, quality: number) {
  const response = await session.post("/api/encode", {
    file,
    format,
    quality,
  });

  return encodeResponseSchema.parse(await response.json());
}

/**
 * Writes an image through the API, expecting it to succeed.
 *
 * @param request - The request's body.
 */
async function write(request: Record<string, unknown>) {
  const response = await session.post("/api/write", request);

  expect(response.status).toBe(200);
  return writeResponseSchema.parse(await response.json());
}

beforeAll(async () => {
  session = await startUiSession(["gradient-16bit.png", "sub/lossy.webp"]);
  sessionFolder = await findSessionFolder(session.api);
});
afterAll(async () => {
  await session.close();
});

describe("POST /api/write", () => {
  it("writes a re-encode beside its original, replacing another file only with overwrite", async () => {
    const encoded = await encode(GRADIENT, "webp", 60);
    const target = path.join(session.root, "gradient-16bit.webp");
    const request = { original: GRADIENT, candidate: encoded.ref };

    expect(await write(request)).toEqual({
      ref: "root/gradient-16bit.webp",
      outcome: "written",
    });
    expect((await stat(target)).size).toBe(encoded.bytes);
    expect(await write(request)).toEqual({
      ref: "root/gradient-16bit.webp",
      outcome: "exists",
    });

    const lower = await encode(GRADIENT, "webp", 40);

    expect(
      await write({ original: GRADIENT, candidate: lower.ref, overwrite: true })
    ).toMatchObject({ outcome: "written" });
    expect((await stat(target)).size).toBe(lower.bytes);
    expect(await readdir(session.root)).toEqual([
      "gradient-16bit.png",
      "gradient-16bit.webp",
      "sub",
    ]);
  });

  it("replaces the original only with inPlace, and re-encodes the new one afterwards", async () => {
    const original = "root/sub/lossy.webp";
    const originalPath = path.join(session.root, "sub", "lossy.webp");
    const encoded = await encode(original, "webp", 40);
    const request = { original, candidate: encoded.ref };

    expect(await write(request)).toEqual({ ref: original, outcome: "input" });
    expect(await readFile(originalPath)).toEqual(
      await readFile(fixturePath("lossy.webp"))
    );
    expect(await write({ ...request, inPlace: true })).toEqual({
      ref: original,
      outcome: "written",
    });
    expect((await stat(originalPath)).size).toBe(encoded.bytes);

    const again = await encode(original, "webp", 40);

    expect(again.ref).not.toBe(encoded.ref); // made from the new file, not the cache
  });

  it("writes nothing for the original as it was", async () => {
    const copy = path.join(sessionFolder, "runs", "900", "0", "lossy.webp");

    await mkdir(path.dirname(copy), { recursive: true });
    await copyFile(path.join(session.root, "sub", "lossy.webp"), copy);
    expect(
      await write({
        original: "root/sub/lossy.webp",
        candidate: "session/runs/900/0/lossy.webp",
      })
    ).toEqual({ ref: "root/sub/lossy.webp", outcome: "unchanged" });
  });

  it("writes an upload's output in the folder served", async () => {
    const form = new FormData();
    const bytes = await readFile(fixturePath("gradient-16bit.png"));

    form.append("file", new Blob([bytes]), "uploaded.png");

    const upload = await session.api("/api/upload", {
      method: "POST",
      body: form,
    });
    const [uploaded] = uploadResponseSchema.parse(await upload.json()).files;
    const encoded = await encode(uploaded?.ref ?? "", "avif", 50);

    expect(
      await write({ original: uploaded?.ref, candidate: encoded.ref })
    ).toEqual({ ref: "root/uploaded.avif", outcome: "written" });
    expect((await stat(path.join(session.root, "uploaded.avif"))).size).toBe(
      encoded.bytes
    );
  });

  it("refuses an image larger than its original with 422", async () => {
    const large = path.join(sessionFolder, "encodes", "900", "large.jpg");

    await writeText(large, "x".repeat(60_000)); // the original is 57,107 bytes

    const response = await session.post("/api/write", {
      original: GRADIENT,
      candidate: "session/encodes/900/large.jpg",
    });

    expect(response.status).toBe(422);
    expect(apiErrorSchema.parse(await response.json()).error).toMatch(
      /larger than the original/
    );
    await expect(
      stat(path.join(session.root, "gradient-16bit.jpg"))
    ).rejects.toThrow();
  });

  it.each([
    [
      "a candidate in the folder served",
      { original: GRADIENT, candidate: GRADIENT },
    ],
    [
      "an original that is an output",
      {
        original: "session/runs/900/0/lossy.webp",
        candidate: "session/runs/900/0/lossy.webp",
      },
    ],
    [
      "a ref out of its folder",
      {
        original: "root/../secret.png",
        candidate: "session/runs/900/0/lossy.webp",
      },
    ],
    ["a missing candidate", { original: GRADIENT }],
  ])("refuses %s with 400", async (_name, request) => {
    const response = await session.post("/api/write", request);

    expect(response.status).toBe(400);
  });

  it("answers 404 for a candidate that doesn't exist", async () => {
    const response = await session.post("/api/write", {
      original: GRADIENT,
      candidate: "session/encodes/901/missing.webp",
    });

    expect(response.status).toBe(404);
  });
});
