import { mkdir, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openedFileSchema } from "../../src/app/api.js";
import { startAppSession } from "./appSession.js";
import type { AppSession } from "./appSession.js";

let session: AppSession;
let linked = false;

beforeAll(async () => {
  session = await startAppSession(["gradient.png", "title-viewbox.svg"]);
  await writeFile(path.join(session.folder, "notes.txt"), "not an image");
  await writeFile(path.join(session.folder, "fake.png"), "not an image");
  await mkdir(path.join(session.folder, "folder.png"));
  try {
    await symlink(session.secret, path.join(session.folder, "link.png"));
    linked = true;
  } catch {
    // windows needs developer mode to create a symlink
  }
});
afterAll(async () => {
  await session.close();
});

describe("open", () => {
  it("gives each image a ref with its name and size, which the API then serves", async () => {
    const file = path.join(session.folder, "gradient.png");
    const [opened] = await session.app.open([file]);

    expect(openedFileSchema.parse(opened)).toEqual({
      ref: session.ref("gradient.png"),
      name: "gradient.png",
      bytes: (await stat(file)).size,
    });
    expect(session.ref("gradient.png")).toBe("file/1/gradient.png");
    expect((await session.image(session.ref("gradient.png"))).status).toBe(200);
  });

  it("gives the same ref to a file opened again, however its path is written", async () => {
    const spellings = [
      path.join(session.folder, "title-viewbox.svg"),
      `${session.folder}${path.sep}.${path.sep}title-viewbox.svg`,
      ...(process.platform === "linux"
        ? []
        : [path.join(session.folder, "TITLE-viewbox.svg")]), // their file systems usually ignore case
    ];
    const opened = await session.app.open(spellings);
    const { size } = await stat(path.join(session.folder, "title-viewbox.svg"));

    expect(opened).toEqual(
      spellings.map(() => ({
        ref: session.ref("title-viewbox.svg"),
        name: "title-viewbox.svg",
        bytes: size,
      }))
    );
  });

  it.each([
    ["a text file", "notes.txt", "notes.txt isn't a PNG, JPEG, WebP, AVIF"],
    ["a file named as an image", "fake.png", "fake.png isn't a PNG"],
    ["a folder", "folder.png", "folder.png isn't a file"],
    ["a missing file", "missing.png", "missing.png can't be found"],
  ])("refuses %s, and gives it no ref", async (_name, file, error) => {
    const [refused, next] = await session.app.open([
      path.join(session.folder, file),
      session.secret,
    ]);

    expect(refused).toEqual({
      name: file,
      error: expect.stringContaining(error) as string,
    });
    expect(next).toMatchObject({
      ref: expect.stringMatching(/^file\/3\//) as string,
    }); // the refusal took no number
  });

  it("opens a link as the file it leads to", async (context) => {
    if (!linked) {
      context.skip();
    }

    const [link, target] = await session.app.open([
      path.join(session.folder, "link.png"),
      session.secret,
    ]);

    expect(link).toMatchObject({ name: "secret.png" });
    expect(link).toEqual(target);
  });
});
