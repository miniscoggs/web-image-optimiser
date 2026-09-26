import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  diffResponseSchema,
  encodeResponseSchema,
} from "../../src/server/api.js";
import { startUiSession } from "./uiSession.js";
import type { UiSession } from "./uiSession.js";

let session: UiSession;

beforeAll(async () => {
  session = await startUiSession([
    "gradient-16bit.png",
    "logo-alpha.png",
    "icon-6x6.png",
    "title-viewbox.svg",
  ]);
});
afterAll(async () => {
  await session.close();
});

describe("POST /api/encode", () => {
  it("re-encodes a file at a quality and scores it, caching the result", async () => {
    const request = {
      file: "root/gradient-16bit.png",
      format: "webp",
      quality: 60,
    };
    const response = await session.post("/api/encode", request);
    const body = encodeResponseSchema.parse(await response.json());
    const again = encodeResponseSchema.parse(
      await (await session.post("/api/encode", request)).json()
    );
    const image = await session.image(body.ref);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ref: expect.stringMatching(
        /^session\/encodes\/\d+\/gradient-16bit\.webp$/
      ) as string,
      format: "webp",
      quality: 60,
      warnings: [],
    });
    expect(body.score).toBeGreaterThan(30);
    expect(body.saving).toBeGreaterThan(0);
    expect(again).toEqual(body);
    expect(image.headers.get("content-type")).toBe("image/webp");
    expect((await image.arrayBuffer()).byteLength).toBe(body.bytes);
  });

  it.each([
    ["an SVG", "root/title-viewbox.svg", "E_UNSUPPORTED_FORMAT"],
    ["an image under 8x8", "root/icon-6x6.png", "E_TOO_SMALL_TO_SCORE"],
  ])(
    "refuses %s with 422 and the optimiser's code",
    async (_name, file, code) => {
      const response = await session.post("/api/encode", {
        file,
        format: "avif",
        quality: 50,
      });

      expect(response.status).toBe(422);
      expect(apiErrorSchema.parse(await response.json()).code).toBe(code);
    }
  );

  it.each([
    ["a quality of 0", { quality: 0 }],
    ["a lossless format", { format: "png" }],
    ["a ref out of the root", { file: "root/../secret.png" }],
  ])("refuses %s with 400", async (_name, change) => {
    const response = await session.post("/api/encode", {
      file: "root/gradient-16bit.png",
      format: "webp",
      quality: 60,
      ...change,
    });

    expect(response.status).toBe(400);
  });
});

describe("POST /api/diff", () => {
  it("draws a diff map the size of the images, caching it", async () => {
    const encoded = encodeResponseSchema.parse(
      await (
        await session.post("/api/encode", {
          file: "root/gradient-16bit.png",
          format: "jpeg",
          quality: 40,
        })
      ).json()
    );
    const request = {
      original: "root/gradient-16bit.png",
      candidate: encoded.ref,
    };
    const response = await session.post("/api/diff", request);
    const body = diffResponseSchema.parse(await response.json());
    const again = diffResponseSchema.parse(
      await (await session.post("/api/diff", request)).json()
    );
    const image = await session.image(body.ref);
    const metadata = await sharp(
      Buffer.from(await image.arrayBuffer())
    ).metadata();

    expect(response.status).toBe(200);
    expect(body.ref).toMatch(/^session\/diffs\/\d+\/diff\.png$/);
    expect(again).toEqual(body);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(metadata).toMatchObject({ format: "png", width: 256, height: 192 });
  });

  it("refuses images of different sizes with 422", async () => {
    const response = await session.post("/api/diff", {
      original: "root/gradient-16bit.png",
      candidate: "root/logo-alpha.png",
    });

    expect(response.status).toBe(422);
    expect(apiErrorSchema.parse(await response.json()).code).toBe(
      "E_DIMENSIONS_MISMATCH"
    );
  });

  it("refuses a ref out of the root with 400", async () => {
    const response = await session.post("/api/diff", {
      original: "root/gradient-16bit.png",
      candidate: "root/../secret.png",
    });

    expect(response.status).toBe(400);
  });
});
