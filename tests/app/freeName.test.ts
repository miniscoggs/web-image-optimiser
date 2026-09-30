import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFreeNames, nextFreeName } from "../../src/app/freeName.js";

let folder = "";

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

/**
 * Returns a check for names in a list.
 *
 * @param names - The names taken.
 */
const takenFrom = (names: string[]) => (name: string) => names.includes(name);

describe("nextFreeName", () => {
  it.each(["win32", "linux", "darwin"] as const)(
    "keeps a free name on %s",
    (platform) => {
      expect(nextFreeName("photo.jpg", takenFrom([]), platform)).toBe(
        "photo.jpg"
      );
    }
  );

  it.each(["win32", "linux"] as const)(
    "counts copies from 1 in brackets on %s, counting on from a name that has a count",
    (platform) => {
      const next = (name: string, taken: string[]) =>
        nextFreeName(name, takenFrom(taken), platform);

      expect(next("photo.jpg", ["photo.jpg"])).toBe("photo (1).jpg");
      expect(next("photo.jpg", ["photo.jpg", "photo (1).jpg"])).toBe(
        "photo (2).jpg"
      );
      expect(next("image (1).jpeg", ["image (1).jpeg"])).toBe("image (2).jpeg");
      expect(next("image (1).jpeg", ["image (1).jpeg", "image (2).jpeg"])).toBe(
        "image (3).jpeg"
      );
      expect(next("notes", ["notes"])).toBe("notes (1)");
    }
  );

  it("counts copies from 2 on macOS, as Finder does, never reading a count in the name", () => {
    const next = (name: string, taken: string[]) =>
      nextFreeName(name, takenFrom(taken), "darwin");

    expect(next("photo.jpg", ["photo.jpg"])).toBe("photo 2.jpg");
    expect(next("photo.jpg", ["photo.jpg", "photo 2.jpg"])).toBe("photo 3.jpg");
    expect(next("image 2.jpeg", ["image 2.jpeg"])).toBe("image 2 2.jpeg");
    expect(next("image (1).jpeg", ["image (1).jpeg"])).toBe("image (1) 2.jpeg");
  });
});

describe("createFreeNames", () => {
  it("counts the folder's names and those it hands out as taken, ignoring case where the OS does", async () => {
    folder = await mkdtemp(path.join(tmpdir(), "wio-names-"));
    await writeFile(path.join(folder, "Photo.JPG"), "");
    await writeFile(path.join(folder, "café.png"), ""); // decomposed, as macOS once stored names

    const windows = await createFreeNames(folder, "win32");
    const linux = await createFreeNames(folder, "linux");

    expect(windows("photo.jpg")).toBe("photo (1).jpg");
    expect(windows("photo.jpg")).toBe("photo (2).jpg");
    expect(windows("café.png")).toBe("café (1).png");
    expect(linux("photo.jpg")).toBe("photo.jpg");
    expect(linux("photo.jpg")).toBe("photo (1).jpg");
  });

  it("hands out names in a folder that doesn't exist yet", async () => {
    folder = path.join(tmpdir(), "wio-names-missing");

    const names = await createFreeNames(folder, "darwin");

    expect(names("a.png")).toBe("a.png");
    expect(names("A.png")).toBe("A 2.png");
  });
});
