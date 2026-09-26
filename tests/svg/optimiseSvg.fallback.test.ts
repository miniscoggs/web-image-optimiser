import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { fixturePath } from "../fixtureManifest.js";

vi.doMock("../../src/metrics/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/metrics/index.js")>()),
  score: () => Promise.resolve(50), // every candidate falls short of 90
}));

const { optimiseSvg } = await import("../../src/svg/index.js");

describe("optimiseSvg when no precision renders the same", () => {
  it("falls back to the metadata-only pass", async () => {
    const source = await readFile(fixturePath("editor-metadata.svg"));
    const result = await optimiseSvg(source);
    const text = result.bytes.toString();

    expect(result).toMatchObject({ method: "strip", score: 100 });
    expect(text).not.toMatch(/inkscape:|sodipodi:|<metadata|<!--/);
    expect(text).toContain("40.123456789"); // geometry untouched
  });
});
