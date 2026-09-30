import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  rightsResponseSchema,
  savedOutputSchema,
  savedSuiteFileSchema,
  searchResponseSchema,
} from "../../src/app/api.js";
import { fixturePath } from "../fixtureManifest.js";
import { startAppSession } from "./appSession.js";
import type { AppSession } from "./appSession.js";

let session: AppSession;
let saves = 0;

beforeAll(async () => {
  session = await startAppSession([
    "gradient-16bit.png",
    "icon-6x6.png",
    "a/logo-alpha.png",
    "b/logo-alpha.png",
  ]);
});
afterAll(async () => {
  await session.close();
});

/**
 * Searches an opened file at the web target, and returns the output's ref.
 *
 * @param file - The file's ref.
 * @param format - The format.
 */
async function searchedRef(file: string, format: "webp" | "png") {
  const response = await session.post("/api/search", {
    file,
    format,
    target: "web",
  });

  return searchResponseSchema.parse(await response.json()).ref;
}

/**
 * Makes a new, empty folder to save into.
 */
async function newFolder() {
  const folder = path.join(session.outside, `saved-${(saves += 1)}`);

  await mkdir(folder);
  return folder;
}

/**
 * Returns the name the OS gives the nth copy of a file.
 *
 * @param stem - The name without its extension.
 * @param count - Which copy, from 1.
 * @param extension - The extension.
 */
function copyName(stem: string, count: number, extension: string) {
  return process.platform === "darwin"
    ? `${stem} ${count + 1}${extension}`
    : `${stem} (${count})${extension}`;
}

describe("saveOutput", () => {
  it("writes the output where it was asked, leaving no temp file", async () => {
    const original = session.ref("gradient-16bit.png");
    const candidate = await searchedRef(original, "webp");
    const folder = await newFolder();
    const saved = await session.app.saveOutput({
      original,
      candidate,
      to: path.join(folder, "gradient.webp"),
      replace: false,
    });

    expect(savedOutputSchema.parse(saved)).toEqual({
      name: "gradient.webp",
      written: true,
      replacedOriginal: false,
    });
    expect(await readdir(folder)).toEqual(["gradient.webp"]);
    expect(await readFile(path.join(folder, "gradient.webp"))).toEqual(
      await session.bytesOf(candidate)
    );
  });

  it("replaces an existing file only when the dialog confirmed it", async () => {
    const original = session.ref("gradient-16bit.png");
    const candidate = await searchedRef(original, "webp");
    const to = path.join(await newFolder(), "taken.webp");
    const save = (replace: boolean) =>
      session.app.saveOutput({ original, candidate, to, replace });

    await writeFile(to, "someone's file");
    await expect(save(false)).rejects.toThrow(
      "taken.webp already exists, and replacing it wasn't confirmed"
    );
    expect(await readFile(to, "utf8")).toBe("someone's file");
    await expect(save(true)).resolves.toMatchObject({ written: true });
    expect(await readFile(to)).toEqual(await session.bytesOf(candidate));
  });

  it("replaces the original only when the dialog confirmed it", async () => {
    const to = path.join(session.folder, "in-place.png");

    await copyFile(fixturePath("gradient-16bit.png"), to);

    const [original = ""] = await session.open(to);
    const candidate = await searchedRef(original, "png");
    const save = (replace: boolean) =>
      session.app.saveOutput({ original, candidate, to, replace });
    const bytes = await session.bytesOf(candidate);

    await expect(save(false)).rejects.toThrow(
      "in-place.png is the original, and replacing it wasn't confirmed"
    );
    await expect(save(true)).resolves.toEqual({
      name: "in-place.png",
      written: true,
      replacedOriginal: true,
    });
    expect(await readFile(to)).toEqual(bytes);
    expect(await session.bytesOf(original)).toEqual(bytes); // the ref leads to the file as it is now
  });

  it.each([
    [
      "a name for another format",
      "gradient.png",
      "A WebP needs a name ending in .webp",
    ],
    ["a relative path", "relative", "Expected an absolute path"],
  ])("refuses %s", async (_name, to, error) => {
    const original = session.ref("gradient-16bit.png");
    const candidate = await searchedRef(original, "webp");
    const folder = await newFolder();

    await expect(
      session.app.saveOutput({
        original,
        candidate,
        to: to === "relative" ? "gradient.webp" : path.join(folder, to),
        replace: false,
      })
    ).rejects.toThrow(error);
    expect(await readdir(folder)).toEqual([]);
  });

  it.each([
    ["an opened file", () => session.ref("icon-6x6.png"), "Not an output"],
    ["a file that wasn't opened", () => "file/99/a.png", "Not an output"],
    [
      "a ref out of the session folder",
      () => "session/runs/../../a.png",
      "Not a file reference",
    ],
  ])("refuses %s as the output", async (_name, candidate, error) => {
    await expect(
      session.app.saveOutput({
        original: session.ref("gradient-16bit.png"),
        candidate: candidate(),
        to: path.join(session.outside, "a.png"),
        replace: false,
      })
    ).rejects.toThrow(error);
  });
});

describe("savePath", () => {
  it("starts in the original's folder, with the output's name, or the next free one", async () => {
    const original = session.ref("a/logo-alpha.png");
    const folder = path.join(session.folder, "a");
    const webp = await searchedRef(original, "webp");
    const png = await searchedRef(original, "png");

    await expect(
      session.app.savePath({ original, candidate: webp })
    ).resolves.toBe(path.join(folder, "logo-alpha.webp"));
    await expect(
      session.app.savePath({ original, candidate: png })
    ).resolves.toBe(
      path.join(folder, copyName("logo-alpha", 1, ".png")) // the original has its name
    );
  });
});

describe("saveFolder", () => {
  it("starts in the first original's folder", async () => {
    await expect(
      session.app.saveFolder([
        { original: session.ref("b/logo-alpha.png"), candidates: [] },
        { original: session.ref("a/logo-alpha.png"), candidates: [] },
      ])
    ).resolves.toBe(path.join(session.folder, "b"));
  });

  it("refuses a file that wasn't opened, and no files at all", async () => {
    await expect(
      session.app.saveFolder([
        { original: "file/99/logo-alpha.png", candidates: [] },
      ])
    ).rejects.toMatchObject({ status: 404 });
    await expect(session.app.saveFolder([])).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("saveSuites", () => {
  it("names outputs as the CLI does, taking the next free name across the folder and the batch", async () => {
    const first = session.ref("a/logo-alpha.png");
    const second = session.ref("b/logo-alpha.png");
    const folder = await newFolder();
    const suites = [
      {
        original: first,
        candidates: [
          await searchedRef(first, "webp"),
          await searchedRef(first, "png"),
        ],
      },
      {
        original: second,
        candidates: [
          await searchedRef(second, "webp"),
          await searchedRef(second, "png"),
        ],
      },
    ];

    await writeFile(path.join(folder, "logo-alpha.webp"), "someone's file");

    const saved = await session.app.saveSuites(suites, folder);
    const names = [
      copyName("logo-alpha", 1, ".webp"),
      "logo-alpha.png",
      copyName("logo-alpha", 2, ".webp"),
      copyName("logo-alpha", 1, ".png"),
    ];

    expect(saved.map((file) => savedSuiteFileSchema.parse(file))).toEqual(
      suites.flatMap((suite, index) =>
        suite.candidates.map((candidate, position) => ({
          original: suite.original,
          candidate,
          name: names[index * 2 + position],
          wanted: position === 0 ? "logo-alpha.webp" : "logo-alpha.png",
        }))
      )
    );
    expect((await readdir(folder)).toSorted()).toEqual(
      ["logo-alpha.webp", ...names].toSorted()
    );
    expect(await readFile(path.join(folder, "logo-alpha.webp"), "utf8")).toBe(
      "someone's file"
    );
    for (const file of saved) {
      expect(await readFile(path.join(folder, file.name))).toEqual(
        await session.bytesOf(file.candidate)
      );
    }
  });

  it("leaves an output that is its original, unchanged, where it is", async () => {
    const icon = session.ref("icon-6x6.png");
    const to = path.join(session.folder, "stripped.png");

    await writeFile(to, await session.bytesOf(await searchedRef(icon, "png"))); // a png with nothing left to strip

    const [original = ""] = await session.open(to);
    const candidate = await searchedRef(original, "png");

    expect(await session.bytesOf(candidate)).toEqual(await readFile(to));
    await expect(
      session.app.saveSuites(
        [{ original, candidates: [candidate] }],
        session.folder
      )
    ).resolves.toEqual([
      { original, candidate, name: "stripped.png", wanted: "stripped.png" },
    ]);
    expect(
      (await readdir(session.folder)).filter((name) =>
        name.startsWith("stripped")
      )
    ).toEqual(["stripped.png"]);
  });

  it("writes nothing when an output is larger than its original", async () => {
    const icon = session.ref("icon-6x6.png");
    const logo = session.ref("a/logo-alpha.png");
    const response = await session.post("/api/rights", {
      candidates: [
        { original: icon, candidate: await searchedRef(icon, "png") },
      ],
      rights: { copyright: "© Example, whose notice is longer than the icon" },
    });
    const [larger] = rightsResponseSchema.parse(
      await response.json()
    ).candidates;
    const folder = await newFolder();

    await expect(
      session.app.saveSuites(
        [
          { original: logo, candidates: [await searchedRef(logo, "webp")] },
          { original: icon, candidates: [larger?.ref ?? ""] },
        ],
        folder
      )
    ).rejects.toThrow("The PNG is larger than the original");
    expect(await readdir(folder)).toEqual([]);
  });
});
