import { readdir, readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const METADATA_KINDS = [
  "comment",
  "editor",
  "exif",
  "gps",
  "iptc",
  "text",
  "xmp",
] as const;

type FixtureEntry = {
  file: string;
  kind: string;
  format: "png" | "jpeg" | "webp" | "avif" | "svg";
  width: number;
  height: number;
  alpha: boolean;
  animated: boolean;
  bitDepth: 8 | 16;
  orientation: number;
  icc: "srgb" | "non-srgb" | null;
  metadata: (typeof METADATA_KINDS)[number][];
  source: string;
  licence: string;
};

const FIXTURE_DIR = new URL("../fixtures/", import.meta.url);
const SHARP_FORMATS = {
  png: "png",
  jpeg: "jpeg",
  webp: "webp",
  avif: "heif",
  svg: "svg",
} satisfies Record<FixtureEntry["format"], string>;
const IMAGE_FILE = /\.(png|jpe?g|webp|avif|svg)$/;

const manifestText = await readFile(
  new URL("manifest.json", FIXTURE_DIR),
  "utf8"
);
const { fixtures } = JSON.parse(manifestText) as { fixtures: FixtureEntry[] };

describe("fixture manifest", () => {
  it("lists every fixture file exactly once", async () => {
    const files = await readdir(FIXTURE_DIR);
    const imageFiles = files.filter((file) => IMAGE_FILE.test(file)).toSorted();
    const listed = fixtures.map((fixture) => fixture.file).toSorted();

    expect(listed).toEqual(imageFiles);
  });

  it.each(fixtures)(
    "records the source, licence and metadata kinds of $file",
    (fixture) => {
      expect(fixture.source).not.toBe("");
      expect(fixture.licence).toMatch(/^(MIT|CC0-1\.0)$/);
      expect(METADATA_KINDS).toEqual(expect.arrayContaining(fixture.metadata));
    }
  );

  it.each(fixtures)(
    "matches the traits sharp can see in $file",
    async (fixture) => {
      const bytes = await readFile(new URL(fixture.file, FIXTURE_DIR));
      const metadata = await sharp(bytes).metadata();

      expect(metadata.format).toBe(SHARP_FORMATS[fixture.format]);
      expect(metadata.autoOrient).toEqual({
        width: fixture.width,
        height: fixture.height,
      });
      expect(metadata.hasAlpha).toBe(fixture.alpha);
      expect((metadata.pages ?? 1) > 1).toBe(fixture.animated);
      expect(metadata.depth).toBe(fixture.bitDepth === 16 ? "ushort" : "uchar");
      expect(metadata.orientation ?? 1).toBe(fixture.orientation);
      expect(metadata.icc !== undefined).toBe(fixture.icc !== null);
      expect(metadata.exif !== undefined).toBe(
        fixture.metadata.includes("exif")
      );
      expect(metadata.xmp !== undefined).toBe(fixture.metadata.includes("xmp"));
      expect(metadata.iptc !== undefined).toBe(
        fixture.metadata.includes("iptc")
      );
      expect(metadata.comments !== undefined).toBe(
        fixture.metadata.includes("text")
      );
    }
  );
});
