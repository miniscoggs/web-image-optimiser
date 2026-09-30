import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import commandLineFiles from "../../../desktop/src/main/commandLineFiles.js";

let folder = "";
let photo = "";
let logo = "";

describe("commandLineFiles", () => {
  beforeAll(async () => {
    folder = await mkdtemp(path.join(tmpdir(), "wio-command-line-"));
    photo = path.join(folder, "a photo é.jpg");
    logo = path.join(folder, "logo.png");
    await writeFile(photo, "");
    await writeFile(logo, "");
    await mkdir(path.join(folder, "images"));
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("returns the files after the executable in order, skipping every switch", async () => {
    const argv = [
      "wio.exe",
      "--user-data-dir=C:\\data",
      logo,
      "--inspect=0",
      "-psn_0_12345",
      "--",
      photo,
    ];

    expect(
      await commandLineFiles(argv, { cwd: folder, namesApp: false })
    ).toEqual([logo, photo]);
  });

  it("resolves a relative path against the working folder", async () => {
    expect(
      await commandLineFiles(["wio.exe", "logo.png"], {
        cwd: folder,
        namesApp: false,
      })
    ).toEqual([logo]);
  });

  it("skips the app's own path, the first argument that isn't a switch, when it names one", async () => {
    expect(
      await commandLineFiles(
        ["electron.exe", "--remote-debugging-port=0", logo, photo],
        { cwd: folder, namesApp: true }
      )
    ).toEqual([photo]);
  });

  it("skips a path that is missing or a folder", async () => {
    const argv = [
      "wio.exe",
      path.join(folder, "missing.png"),
      path.join(folder, "images"),
      photo,
    ];

    expect(
      await commandLineFiles(argv, { cwd: folder, namesApp: false })
    ).toEqual([photo]);
  });

  it("returns nothing for the executable alone", async () => {
    expect(
      await commandLineFiles(["wio.exe"], { cwd: folder, namesApp: false })
    ).toEqual([]);
  });
});
