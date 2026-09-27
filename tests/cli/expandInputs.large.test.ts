import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const FILE_COUNT = 130_000; // V8 overflows its stack spreading 125,000 or more arguments

vi.doMock("tinyglobby", async (importOriginal) => ({
  ...(await importOriginal<typeof import("tinyglobby")>()),
  glob: () =>
    Promise.resolve(
      Array.from({ length: FILE_COUNT }, (_value, index) => `${index}.png`)
    ),
}));

const { default: expandInputs } = await import("../../src/cli/expandInputs.js");

describe("expandInputs on a folder with very many images", () => {
  it("lists every one", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "wio-expand-large-"));

    try {
      const inputs = await expandInputs([folder], {
        recursive: false,
        outDir: undefined,
        mode: "webp",
      });

      expect(inputs).toHaveLength(FILE_COUNT);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
