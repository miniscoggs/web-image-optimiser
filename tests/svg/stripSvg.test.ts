import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { inspect } from "../../src/inspect/index.js";
import { decodeForScoring } from "../../src/metrics/index.js";
import { stripSvg } from "../../src/svg/index.js";
import { fixturePath } from "../fixtureManifest.js";

describe("stripSvg", () => {
  it("removes comments and editor data without changing the render", async () => {
    const source = await readFile(fixturePath("editor-metadata.svg"));
    const { bytes, removed } = await stripSvg(source);
    const [before, after] = await Promise.all([
      decodeForScoring(source),
      decodeForScoring(bytes),
    ]);

    expect(removed).toEqual(["comment", "editor"]);
    expect((await inspect(bytes)).metadata).toEqual([]);
    expect(after.data.equals(before.data)).toBe(true);
    expect(bytes.toString()).toContain("40.123456789"); // geometry untouched
  });

  it("returns the input when there is nothing to strip", async () => {
    const source = await readFile(fixturePath("title-viewbox.svg"));
    const { bytes, removed } = await stripSvg(source);

    expect(removed).toEqual([]);
    expect(bytes).toBe(source);
  });

  it("keeps a licence comment", async () => {
    const source = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><!--! Icon licence: CC BY 4.0 --><!-- exported --><rect width="8" height="8"/></svg>'
    );
    const { bytes, removed } = await stripSvg(source);

    expect(removed).toEqual(["comment"]);
    expect(bytes.toString()).toContain("<!--! Icon licence: CC BY 4.0");
    expect(bytes.toString()).not.toContain("exported");
    expect((await inspect(bytes)).metadata).toEqual([]);
  });
});
