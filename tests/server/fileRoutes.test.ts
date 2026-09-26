import { readFile, readdir, symlink } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  filesResponseSchema,
  uploadResponseSchema,
} from "../../src/server/api.js";
import { fixturePath } from "../fixtureManifest.js";
import { startUiSession, writeText } from "./uiSession.js";
import type { UiSession } from "./uiSession.js";

let session: UiSession;
let linked = false;

beforeAll(async () => {
  session = await startUiSession([
    "gradient.png",
    "title-viewbox.svg",
    "sub/logo-alpha.png",
    ".hidden/lossy.webp",
    "node_modules/pkg/exif.avif",
  ]);
  await writeText(path.join(session.root, "notes.txt"), "not an image");
  await writeText(
    path.join(session.root, ".hidden", "fake.png"),
    "not an image"
  );
  try {
    await symlink(session.secret, path.join(session.root, "link.png"));
    linked = true;
  } catch {
    // windows needs developer mode to create a symlink
  }
});
afterAll(async () => {
  await session.close();
});

describe("GET /api/files", () => {
  it("lists the folder's images, with subfolders but not hidden folders or node_modules", async () => {
    const response = await session.api("/api/files");
    const body = filesResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.root.normalize("NFC")).toBe(
      path.resolve(session.root).normalize("NFC")
    );
    expect(body.files).toEqual([
      { ref: "root/gradient.png", bytes: 363_190 },
      { ref: "root/sub/logo-alpha.png", bytes: 4682 },
      { ref: "root/title-viewbox.svg", bytes: 401 },
    ]);
  });
});

describe("GET /api/image/:ref", () => {
  it("serves an image with its type, sandboxed", async () => {
    const response = await session.image("root/sub/logo-alpha.png");
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(bytes.equals(await readFile(fixturePath("logo-alpha.png")))).toBe(
      true
    );
  });

  it("answers 304 for an image unchanged since the page last had it", async () => {
    const ref = "root/sub/logo-alpha.png";
    const etag = (await session.image(ref)).headers.get("etag") ?? "";
    const again = await session.api(`/api/image/${encodeURIComponent(ref)}`, {
      headers: { "if-none-match": etag },
    });

    expect(etag).toMatch(/^"[\d:]+"$/);
    expect(again.status).toBe(304);
    expect(again.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("gives an SVG its type, which comes from the bytes", async () => {
    const response = await session.image("root/title-viewbox.svg");

    expect(response.headers.get("content-type")).toBe("image/svg+xml");
  });

  it.each([
    ["climbs out of the root", "root/../secret.png"],
    ["climbs out of a subfolder", "root/sub/../../secret.png"],
    ["climbs out of the session folder", "session/../secret.png"],
    ["uses a backslash", "root/..\\secret.png"],
    ["has an empty part", "root//secret.png"],
    ["names no file", "root"],
    ["names no known folder", "outside/secret.png"],
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

  it("answers 404 for a file that isn't an image, by its name or its bytes", async () => {
    const text = await session.image("root/notes.txt");
    const fake = await session.image("root/.hidden/fake.png");

    expect(text.status).toBe(404);
    expect(fake.status).toBe(404);
    expect(apiErrorSchema.parse(await fake.json()).error).toContain(
      "Not an image"
    );
  });

  it("answers 404 for a missing file or a folder", async () => {
    expect((await session.image("root/missing.png")).status).toBe(404);
    expect((await session.image("root/sub")).status).toBe(404);
  });

  it("answers 404 for a link that leads outside the root, and doesn't list it", async (context) => {
    if (!linked) {
      context.skip();
    }

    const response = await session.image("root/link.png");
    const files = filesResponseSchema.parse(
      await (await session.api("/api/files")).json()
    );

    expect(response.status).toBe(404);
    expect(files.files.map((file) => file.ref)).not.toContain("root/link.png");
  });
});

describe("POST /api/upload", () => {
  it("stores each file in the session folder, without its folders, and lists it", async () => {
    const form = new FormData();
    const png = await readFile(fixturePath("icon-6x6.png"));

    form.append("file", new Blob([png]), "photo (1).png");
    form.append("file", new Blob([png]), "../../escape.png");

    const response = await session.api("/api/upload", {
      method: "POST",
      body: form,
    });
    const body = uploadResponseSchema.parse(await response.json());
    const files = filesResponseSchema.parse(
      await (await session.api("/api/files")).json()
    );
    const served = await session.image(body.files[1]?.ref ?? "");

    expect(response.status).toBe(200);
    expect(body.files).toEqual([
      {
        ref: expect.stringMatching(
          /^session\/uploads\/\d+\/photo \(1\)\.png$/
        ) as string,
        bytes: 116,
      },
      {
        ref: expect.stringMatching(
          /^session\/uploads\/\d+\/escape\.png$/
        ) as string,
        bytes: 116,
      },
    ]);
    expect(files.files.slice(-2)).toEqual(body.files);
    expect(Buffer.from(await served.arrayBuffer()).equals(png)).toBe(true);
    expect(await readdir(session.outside)).toEqual(["root", "secret.png"]);
  });

  it("refuses a file that isn't an image with 400, storing nothing", async () => {
    const form = new FormData();
    const before = filesResponseSchema.parse(
      await (await session.api("/api/files")).json()
    );

    form.append("file", new Blob(["x"]), "a.png");
    form.append("file", new Blob(["x"]), "notes.txt");

    const response = await session.api("/api/upload", {
      method: "POST",
      body: form,
    });
    const after = filesResponseSchema.parse(
      await (await session.api("/api/files")).json()
    );

    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error).toContain(
      "notes.txt"
    );
    expect(after).toEqual(before);
  });

  it("lists an upload whose name starts with a dot", async () => {
    const form = new FormData();

    form.append(
      "file",
      new Blob([await readFile(fixturePath("icon-6x6.png"))]),
      ".hero.png"
    );

    const body = uploadResponseSchema.parse(
      await (
        await session.api("/api/upload", { method: "POST", body: form })
      ).json()
    );
    const files = filesResponseSchema.parse(
      await (await session.api("/api/files")).json()
    );

    expect(files.files.map((file) => file.ref)).toContain(body.files[0]?.ref);
  });

  it("refuses a form without files with 400", async () => {
    const form = new FormData();

    form.append("file", "text, not a file");

    const response = await session.api("/api/upload", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error).toContain(
      "file field"
    );
  });
});
