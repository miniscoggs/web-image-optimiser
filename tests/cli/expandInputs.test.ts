import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import expandInputs from "../../src/cli/expandInputs.js";
import type { ExpandOptions } from "../../src/cli/expandInputs.js";
import { IGNORES_CASE } from "../../src/pipeline/destination.js";
import type { PipelineBatchInput } from "../../src/pipeline/index.js";

const DEFAULTS: ExpandOptions = {
  recursive: false,
  outDir: undefined,
  mode: "webp",
};

let folder = "";

/**
 * Creates empty files in the test folder; expanding reads only their names.
 *
 * @param names - The files' paths, relative to the test folder.
 */
async function touch(...names: string[]) {
  for (const name of names) {
    const target = path.join(folder, name);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "");
  }
}

/**
 * Returns a path in the test folder.
 *
 * @param parts - The path's parts below the test folder.
 */
function at(...parts: string[]) {
  return path.join(folder, ...parts);
}

/**
 * Expands inputs with the defaults and some options changed.
 *
 * @param inputs - The inputs.
 * @param options - The options to change.
 */
async function expand(inputs: string[], options: Partial<ExpandOptions> = {}) {
  return expandInputs(inputs, { ...DEFAULTS, ...options });
}

/**
 * Returns the paths of expanded inputs.
 *
 * @param inputs - The expanded inputs.
 */
function pathsOf(inputs: PipelineBatchInput[]) {
  return inputs.map((input) =>
    typeof input === "string" ? input : input.path
  );
}

/**
 * Returns a glob pattern for a path in the test folder, with / separators.
 *
 * @param pattern - The pattern below the test folder.
 */
function globAt(pattern: string) {
  return `${folder.replaceAll("\\", "/")}/${pattern}`;
}

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "wio expand é-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("expandInputs", () => {
  it("takes a folder's visible images at its top level, by extension in any case, sorted", async () => {
    await touch(
      "b.png",
      "A.JPG",
      "c.svg",
      "d.avif",
      "notes.txt",
      "sub/e.png",
      ".hidden.png"
    );

    expect(await expand([folder])).toEqual([
      at("A.JPG"),
      at("b.png"),
      at("c.svg"),
      at("d.avif"),
    ]);
  });

  it("includes subfolders with recursive, mirroring them under the output folder", async () => {
    await touch("a.png", "blog/2026/b.jpg", ".cache/c.png");

    const outDir = path.join(folder, "..", "web");

    expect(await expand([folder], { recursive: true, outDir })).toEqual([
      { path: at("a.png"), outDir },
      {
        path: at("blog", "2026", "b.jpg"),
        outDir: path.join(outDir, "blog", "2026"),
      },
    ]);
  });

  it("leaves out an output folder inside the scanned folder", async () => {
    await touch("a.png", "web/a.webp", "web/old/b.png");

    const outDir = at("web");

    expect(
      pathsOf(await expand([folder], { recursive: true, outDir }))
    ).toEqual([at("a.png")]);
  });

  it("leaves out scanned files named as this mode's output of an image beside them", async () => {
    await touch("a.png", "a.webp", "b.webp", "c.svg", "c.webp");

    const expected = [
      at("a.png"),
      at("b.webp"), // nothing else writes it
      at("c.svg"),
      at("c.webp"), // an svg stays svg
    ];

    expect(pathsOf(await expand([folder]))).toEqual(expected);
    expect(
      pathsOf(
        await expand([folder], { outDir: path.join(folder, "..", "web") })
      )
    ).toEqual(expected); // an earlier run without an output folder wrote them
  });

  it("leaves out a suite's AVIF and WebP, and keeps every file in same mode", async () => {
    await touch("a.jpg", "a.avif", "a.webp", "b.png");

    expect(pathsOf(await expand([folder], { mode: "suite" }))).toEqual([
      at("a.jpg"),
      at("b.png"),
    ]);
    expect(pathsOf(await expand([folder], { mode: "same" }))).toEqual([
      at("a.avif"),
      at("a.jpg"),
      at("a.webp"),
      at("b.png"),
    ]);
  });

  it("keeps a named file that another input would write", async () => {
    await touch("a.png", "a.webp");

    expect(await expand([at("a.png"), at("a.webp")])).toEqual([
      at("a.png"),
      at("a.webp"),
    ]);
  });

  it("expands a glob pattern into the images it matches, mirroring below its fixed start", async () => {
    await touch("img/a.png", "img/deep/b.png", "img/deep/notes.txt", "c.png");

    const outDir = path.join(folder, "..", "web");
    const inputs = await expand([globAt("img/**/*")], { outDir });

    expect(inputs).toEqual([
      { path: at("img", "a.png"), outDir },
      { path: at("img", "deep", "b.png"), outDir: path.join(outDir, "deep") },
    ]);
  });

  it.runIf(IGNORES_CASE)(
    "matches a glob pattern ignoring case where the file system does",
    async () => {
      await touch("IMG_0001.JPG");

      expect(await expand([globAt("*.jpg")])).toEqual([at("IMG_0001.JPG")]);
    }
  );

  it.runIf(process.platform === "win32")(
    "accepts a glob pattern with Windows separators",
    async () => {
      await touch("img/a.png");

      expect(await expand([`${folder}\\img\\*.png`])).toEqual([
        at("img", "a.png"),
      ]);
    }
  );

  it("passes on a missing file, and a pattern matching no image, as they are", async () => {
    await touch("notes.txt");

    const missing = at("missing.png");
    const pattern = globAt("*.txt");

    expect(await expand([missing, pattern])).toEqual(
      [missing, pattern].toSorted()
    );
  });

  it("treats an existing file with glob characters in its name as a file", async () => {
    await touch("photo (1).png", "[draft].png");

    expect(await expand([at("photo (1).png"), at("[draft].png")])).toEqual([
      at("[draft].png"),
      at("photo (1).png"),
    ]);
  });

  it("lists each file once, keeping the first way it was given", async () => {
    await touch("a.png", "sub/b.png");

    const outDir = path.join(folder, "..", "web");
    const inputs = await expand([at("sub", "b.png"), folder, at("a.png")], {
      recursive: true,
      outDir,
    });

    expect(inputs).toEqual([
      { path: at("a.png"), outDir },
      at("sub", "b.png"), // named first, so it goes straight into the output folder
    ]);
  });

  it("gives nothing for a folder with no images", async () => {
    await touch("notes.txt");

    expect(await expand([folder])).toEqual([]);
  });
});
