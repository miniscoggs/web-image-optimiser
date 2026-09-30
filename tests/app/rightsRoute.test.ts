import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  rightsResponseSchema,
  searchResponseSchema,
} from "../../src/app/api.js";
import { DEFAULT_LANGUAGE, readRights } from "../../src/rights/index.js";
import { readRun, startAppSession } from "./appSession.js";
import type { AppSession } from "./appSession.js";

let session: AppSession;

beforeAll(async () => {
  session = await startAppSession([
    "text-chunks.png",
    "gradient-16bit.png",
    "icon-6x6.png",
    "title-viewbox.svg",
  ]);
});
afterAll(async () => {
  await session.close();
});

/**
 * Searches an opened fixture for its WebP or PNG at the web target, and returns the output's
 * ref.
 *
 * @param fixture - The fixture.
 * @param format - The format.
 */
async function searchedRef(
  fixture: string,
  format: "webp" | "png" | "jpeg" = "webp"
) {
  const response = await session.post("/api/search", {
    file: session.ref(fixture),
    format,
    target: "web",
  });

  return searchResponseSchema.parse(await response.json()).ref;
}

/**
 * Rewrites outputs' rights, and parses the response.
 *
 * @param body - The request.
 */
async function rewrite(body: Record<string, unknown>) {
  const response = await session.post("/api/rights", body);

  expect(response.status).toBe(200);
  return rightsResponseSchema.parse(await response.json()).candidates;
}

describe("POST /api/rights", () => {
  it("fills only the fields an original lacks, without re-encoding", async () => {
    const original = session.ref("text-chunks.png");
    const candidate = await searchedRef("text-chunks.png");
    const before = await session.bytesOf(candidate);
    const [rewritten] = await rewrite({
      candidates: [{ original, candidate }],
      rights: { creator: "Someone Else", copyright: "© Example" },
    });
    const after = await session.bytesOf(rewritten?.ref ?? "");
    const rights = {
      creator: ["Fixture Author"],
      copyright: [{ lang: DEFAULT_LANGUAGE, value: "© Example" }],
    };

    expect(rewritten).toMatchObject({
      ref: expect.stringMatching(
        /^session\/rights\/\d+\/0\/text-chunks\.webp$/
      ) as string,
      bytes: after.byteLength,
      larger: false,
      rights,
      rightsAdded: ["copyright"],
      warnings: [],
    });
    expect(rewritten?.saving).toBeGreaterThan(0);
    expect(readRights(after, "webp")).toEqual(rights);
    expect(await sharp(after).raw().toBuffer()).toEqual(
      await sharp(before).raw().toBuffer()
    );
  });

  it("leaves no XMP with stripAll, and warns about an original without a licence", async () => {
    const original = session.ref("text-chunks.png");
    const candidate = await searchedRef("text-chunks.png");
    const [stripped] = await rewrite({
      candidates: [{ original, candidate }],
      stripAll: true,
    });
    const [plain] = await rewrite({
      candidates: [
        {
          original: session.ref("gradient-16bit.png"),
          candidate: await searchedRef("gradient-16bit.png"),
        },
      ],
    });

    expect(stripped).toMatchObject({
      rights: {},
      rightsAdded: [],
      warnings: [],
    });
    expect(
      (await sharp(await session.bytesOf(stripped?.ref ?? "")).metadata()).xmp
    ).toBeUndefined();
    expect(plain?.warnings.map((warning) => warning.code)).toEqual([
      "W_NO_RIGHTS",
    ]);
  });

  it("marks an output the fields make larger than its original, which then can't be saved", async () => {
    const original = session.ref("icon-6x6.png");
    const [rewritten] = await rewrite({
      candidates: [
        { original, candidate: await searchedRef("icon-6x6.png", "png") },
      ],
      rights: { copyright: "© Example, whose notice is longer than the icon" },
    });

    expect(rewritten).toMatchObject({ larger: true });
    expect(rewritten?.saving).toBeLessThan(0);
    await expect(
      session.app.saveOutput({
        original,
        candidate: rewritten?.ref ?? "",
        to: path.join(session.outside, "icon.png"),
        replace: false,
      })
    ).rejects.toThrow("larger than the original");
  });

  it("drops only the fields an output's format can't hold, rather than failing the request", async () => {
    const original = session.ref("text-chunks.png");
    const [jpeg, webp] = await rewrite({
      candidates: [
        { original, candidate: await searchedRef("text-chunks.png", "jpeg") },
        { original, candidate: await searchedRef("text-chunks.png") },
      ],
      rights: { copyright: "x".repeat(70_000) }, // over a jpeg segment's 64 KB
    });

    expect(jpeg).toMatchObject({
      rights: { creator: ["Fixture Author"] },
      rightsAdded: [],
    });
    expect(jpeg?.warnings.map((warning) => warning.code)).toEqual([
      "W_RIGHTS_NOT_ADDED",
    ]);
    expect(webp?.rightsAdded).toEqual(["copyright"]);
  });

  it("gives an SVG back as it is", async () => {
    const original = session.ref("title-viewbox.svg");
    const events = await readRun(
      await session.post("/api/optimise", { files: [original], target: "web" })
    );
    const output = events.flatMap((event) =>
      event.type === "file-done" ? event.file.outputs : []
    )[0];
    const [rewritten] = await rewrite({
      candidates: [{ original, candidate: output?.path }],
      rights: { credit: "Example" },
    });

    expect(rewritten).toMatchObject({
      ref: output?.path,
      bytes: output?.bytes,
      rights: {},
      rightsAdded: [],
    });
  });

  it.each([
    [
      "an original that isn't an opened file",
      { original: "session/runs/1/0/a.png" },
      "Not a file reference",
    ],
    [
      "a candidate that isn't an output",
      { candidate: "file/1/text-chunks.png" },
      "Not an output",
    ],
  ])("refuses %s with 400", async (_name, change, error) => {
    const response = await session.post("/api/rights", {
      candidates: [
        {
          original: session.ref("text-chunks.png"),
          candidate: await searchedRef("text-chunks.png"),
          ...change,
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error).toContain(error);
  });

  it("refuses stripAll with rights fields with 400", async () => {
    const response = await session.post("/api/rights", {
      candidates: [
        {
          original: session.ref("text-chunks.png"),
          candidate: await searchedRef("text-chunks.png"),
        },
      ],
      stripAll: true,
      rights: { credit: "Example" },
    });

    expect(response.status).toBe(400);
  });
});
