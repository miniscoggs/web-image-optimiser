import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import writeOutputs from "../../src/pipeline/writeOutputs.js";
import { OptimiserError } from "../../src/schema/index.js";

let folder = "";

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "wio-write-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("writeOutputs", () => {
  it("writes every file, creating folders and replacing existing files", async () => {
    const existing = path.join(folder, "a.webp");
    const nested = path.join(folder, "new", "b.avif");

    await writeFile(existing, "old");
    await writeOutputs(
      [
        { path: existing, bytes: Buffer.from("first") },
        { path: nested, bytes: Buffer.from("second") },
      ],
      undefined
    );

    expect(await readFile(existing, "utf8")).toBe("first");
    expect(await readFile(nested, "utf8")).toBe("second");
    expect(await readdir(folder)).toEqual(["a.webp", "new"]);
  });

  it("writes nothing and leaves no temp files when aborted", async () => {
    const target = path.join(folder, "a.webp");
    const write = writeOutputs(
      [{ path: target, bytes: Buffer.alloc(1024) }],
      AbortSignal.abort()
    );

    await expect(write).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(folder)).toEqual([]);
  });

  it("renames nothing when a later file fails, and removes the temp files", async () => {
    const blocker = path.join(folder, "blocker");

    await writeFile(blocker, "");

    const write = writeOutputs(
      [
        { path: path.join(folder, "a.webp"), bytes: Buffer.from("a") },
        { path: path.join(blocker, "b.avif"), bytes: Buffer.from("b") },
      ],
      undefined
    );

    await expect(write).rejects.toThrow(OptimiserError);
    await expect(write).rejects.toMatchObject({ code: "E_WRITE" });
    expect(await readdir(folder)).toEqual(["blocker"]);
  });
});
