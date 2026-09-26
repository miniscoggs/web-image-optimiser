import { readFile } from "node:fs/promises";
import { constants, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { inspect } from "../../src/inspect/index.js";
import { optimiseSvg } from "../../src/svg/index.js";
import { fixturePath } from "../fixtureManifest.js";

describe("optimiseSvg when aborted", () => {
  it("rejects with the signal's reason", async () => {
    const source = await readFile(fixturePath("editor-metadata.svg"));
    const signal = AbortSignal.abort();

    await expect(optimiseSvg(source, { signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

/**
 * Returns the IDs an SVG defines, in document order.
 *
 * @param svg - The SVG's bytes.
 */
function listIds(svg: Buffer) {
  return [...svg.toString().matchAll(/\bid="([^"]+)"/g)].map(
    (match) => match[1]
  );
}

/**
 * Reads and optimises an SVG fixture, and inspects the result.
 *
 * @param file - The fixture's file name.
 */
async function optimiseFixture(file: string) {
  const source = await readFile(fixturePath(file));
  const result = await optimiseSvg(source);

  return { source, result, after: await inspect(result.bytes) };
}

describe("optimiseSvg", () => {
  it.each(["editor-metadata.svg", "use-and-css-ids.svg", "title-viewbox.svg"])(
    "shrinks %s and scores at least 90",
    async (file) => {
      const { source, result, after } = await optimiseFixture(file);

      expect(result.method).toBe("svgo");
      expect(result.score).toBeGreaterThanOrEqual(90);
      expect(result.bytes.length).toBeLessThan(source.length);
      expect(result.gzipBytes).toBe(
        gzipSync(result.bytes, { level: constants.Z_BEST_COMPRESSION }).length
      );
      expect(after.metadata).toEqual([]);
      expect(after.svg?.viewBox).toBe(true);
    }
  );

  it("keeps IDs, classes and references", async () => {
    const { source, result, after } = await optimiseFixture(
      "use-and-css-ids.svg"
    );

    expect(listIds(result.bytes)).toEqual(listIds(source));
    expect(result.bytes.toString()).toContain('class="outline"');
    expect(after.svg?.referencedIds).toEqual([
      "badge",
      "shine",
      "star",
      "star-1",
    ]);
  });

  it("keeps the title, description and accessibility attributes", async () => {
    const { result, after } = await optimiseFixture("title-viewbox.svg");
    const text = result.bytes.toString();

    expect(after.svg).toEqual({
      viewBox: true,
      title: true,
      referencedIds: ["desc", "title"],
    });
    expect(text).toContain('role="img"');
    expect(text).toContain("<desc");
  });

  it("removes editor data and trims long decimals", async () => {
    const { source, result } = await optimiseFixture("editor-metadata.svg");
    const text = result.bytes.toString();

    expect(result.bytes.length).toBeLessThan(source.length / 2);
    expect(text).not.toMatch(/inkscape|sodipodi|<metadata|<!--/);
    expect(text).not.toContain("40.123456789"); // path data, rounded to the precision
    expect(text).not.toContain("186.49999999");
  });
});
