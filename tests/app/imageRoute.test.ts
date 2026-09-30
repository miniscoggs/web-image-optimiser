import { copyFile, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiErrorSchema } from "../../src/app/api.js";
import { fixturePath } from "../fixtureManifest.js";
import { startAppSession } from "./appSession.js";
import type { AppSession } from "./appSession.js";

let session: AppSession;

beforeAll(async () => {
  session = await startAppSession([
    "gradient.png",
    "title-viewbox.svg",
    "sub/logo-alpha.png",
  ]);
});
afterAll(async () => {
  await session.close();
});

/**
 * Opens a new copy of a fixture, and returns its path and ref.
 *
 * @param name - The copy's name.
 */
async function openCopy(name: string) {
  const filePath = path.join(session.folder, name);

  await copyFile(fixturePath("logo-alpha.png"), filePath);

  const [ref = ""] = await session.open(filePath);

  return { filePath, ref };
}

describe("GET /api/image/:ref", () => {
  it("serves an opened image with its type, sandboxed", async () => {
    const response = await session.image(session.ref("sub/logo-alpha.png"));
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(bytes.equals(await readFile(fixturePath("logo-alpha.png")))).toBe(
      true
    );
  });

  it("answers 304 for an image unchanged since the page last had it", async () => {
    const ref = session.ref("sub/logo-alpha.png");
    const etag = (await session.image(ref)).headers.get("etag") ?? "";
    const again = await session.api(`/api/image/${encodeURIComponent(ref)}`, {
      headers: { "if-none-match": etag },
    });

    expect(etag).toMatch(/^"[\d:]+"$/);
    expect(again.status).toBe(304);
    expect(again.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("gives an SVG its type, which comes from the bytes", async () => {
    const response = await session.image(session.ref("title-viewbox.svg"));

    expect(response.headers.get("content-type")).toBe("image/svg+xml");
  });

  it.each([
    ["climbs out of the session folder", "session/../secret.png"],
    ["uses a backslash", "session/..\\secret.png"],
    ["has an empty part", "session//secret.png"],
    ["names no file", "session"],
    ["names an opened file by nothing", "file"],
    ["names no known kind of file", "root/gradient.png"],
  ])("refuses a ref that %s with 400", async (_name, ref) => {
    const response = await session.image(ref);

    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error).toContain(
      "Not a file reference"
    );
  });

  it("refuses an absolute path", async () => {
    const response = await session.image(session.secret);

    expect(response.status).toBe(400);
  });

  it.each([
    ["a file that wasn't opened", "file/99/secret.png"],
    ["an opened file's number with another name", "file/1/secret.png"],
    ["an opened file's name climbing out", "file/1/../../secret.png"],
    ["a missing file in the session folder", "session/runs/1/0/a.png"],
  ])("answers 404 for %s", async (_name, ref) => {
    const response = await session.image(ref);

    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(await response.json()).error).toContain(
      "No such image"
    );
  });

  it("answers 404 for an opened file since removed, or no longer an image", async () => {
    const removed = await openCopy("removed.png");
    const replaced = await openCopy("replaced.png");

    await rm(removed.filePath);
    await writeFile(replaced.filePath, "not an image");

    const gone = await session.image(removed.ref);
    const text = await session.image(replaced.ref);

    expect(gone.status).toBe(404);
    expect(text.status).toBe(404);
    expect(apiErrorSchema.parse(await text.json()).error).toContain(
      "Not an image"
    );
  });

  it("answers 404 for an opened file since replaced by a link", async (context) => {
    const { filePath, ref } = await openCopy("swapped.png");

    await rm(filePath);
    try {
      await symlink(session.secret, filePath);
    } catch {
      context.skip(); // windows needs developer mode to create a symlink
    }

    const response = await session.image(ref);

    expect(response.status).toBe(404);
  });
});
