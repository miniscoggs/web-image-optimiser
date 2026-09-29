import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspect } from "../../src/inspect/index.js";
import {
  PIPELINE_MODES,
  optimiseBatch,
  optimiseFile,
} from "../../src/pipeline/index.js";
import type {
  PipelineFileResult,
  PipelineOptions,
} from "../../src/pipeline/index.js";
import {
  buildRightsPacket,
  readRights,
  setRights,
} from "../../src/rights/index.js";
import { stripLossless } from "../../src/strip/index.js";
import { fixturePath, fixtures } from "../fixtureManifest.js";

const ALL_RIGHTS = fixtures.find(
  (fixture) => fixture.file === "rights.jpg"
)?.rights; // every field, in XMP

let folder = "";

/**
 * Returns a result's warning codes.
 *
 * @param result - The file's result.
 */
function warningCodes(result: PipelineFileResult) {
  return result.warnings.map((warning) => warning.code);
}

/**
 * Returns what `inspect` reports about each written output.
 *
 * @param result - The file's result.
 */
async function inspectOutputs(result: PipelineFileResult) {
  return Promise.all(
    result.outputs.map(async (output) => inspect(await readFile(output.path)))
  );
}

/**
 * Optimises a file into the test folder.
 *
 * @param input - The input's path.
 * @param options - The options, besides the output folder.
 */
function optimise(input: string, options: PipelineOptions) {
  return optimiseFile(input, { ...options, outDir: path.join(folder, "out") });
}

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "wio rights-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("optimiseFile with rights", () => {
  it.each(PIPELINE_MODES)("keeps every rights field in %s mode", async (to) => {
    const result = await optimise(fixturePath("rights.jpg"), { to });

    expect(result.status).toBe("optimised");
    expect(result.outputs.length).toBeGreaterThan(0);
    expect(warningCodes(result)).toEqual([]);
    for (const [index, info] of (await inspectOutputs(result)).entries()) {
      const output = result.outputs[index];

      expect(output?.rights).toEqual(ALL_RIGHTS);
      expect(output?.rightsAdded).toBeUndefined();
      expect(output?.strippedMetadata).toContain("xmp"); // rewritten
      expect(info.rights).toEqual(ALL_RIGHTS);
      expect(info.metadata).toEqual(["xmp"]);
    }
  });

  it("moves a PNG's Author text into XMP", async () => {
    const result = await optimise(fixturePath("text-chunks.png"), {
      to: "same",
    });
    const [info] = await inspectOutputs(result);

    expect(result.outputs[0]).toMatchObject({
      format: "png",
      rights: { creator: ["Fixture Author"] },
    });
    expect(info?.metadata).toEqual(["xmp"]);
    expect(info?.rights).toEqual({ creator: ["Fixture Author"] });
  });

  it("fills only the fields a file lacks", async () => {
    const result = await optimise(fixturePath("orientation-6.jpg"), {
      rights: { creator: "Someone Else", copyright: "Copyright Example" },
    });
    const expected = {
      creator: ["Fixture Author"],
      copyright: [{ lang: "x-default", value: "Copyright Example" }],
    };
    const [info] = await inspectOutputs(result);

    expect(result.outputs[0]).toMatchObject({
      format: "webp",
      rights: expected,
      rightsAdded: ["copyright"],
    });
    expect(info?.rights).toEqual(expected);
    expect(warningCodes(result)).toEqual([]);
  });

  it("adds every field to a file with none", async () => {
    const result = await optimise(fixturePath("display-p3.jpg"), {
      rights: {
        creator: " Ada Example ",
        credit: "Example Library",
        copyright: "Copyright Example",
        rightsUrl: "https://example.com/licence",
        licensorUrl: "https://example.com/buy",
      },
    });
    const expected = {
      creator: ["Ada Example"],
      credit: "Example Library",
      copyright: [{ lang: "x-default", value: "Copyright Example" }],
      webStatement: "https://example.com/licence",
      licensorUrl: ["https://example.com/buy"],
    };
    const [info] = await inspectOutputs(result);

    expect(result.outputs[0]).toMatchObject({
      rights: expected,
      rightsAdded: [
        "creator",
        "credit",
        "copyright",
        "webStatement",
        "licensorUrl",
      ],
    });
    expect(info?.rights).toEqual(expected);
    expect(warningCodes(result)).toEqual([]);
  });

  it.each(["same", "webp"] as const)(
    "leaves no XMP with stripAll in %s mode",
    async (to) => {
      const result = await optimise(fixturePath("rights.jpg"), {
        to,
        stripAll: true,
      });
      const [info] = await inspectOutputs(result);

      expect(result.outputs[0]?.rights).toBeUndefined();
      expect(result.outputs[0]?.strippedMetadata).toContain("xmp");
      expect(info).toMatchObject({ metadata: [], rights: {} });
      expect(warningCodes(result)).toEqual([]);
    }
  );

  describe("W_NO_RIGHTS", () => {
    it("warns when the outputs carry no licence field", async () => {
      const result = await optimise(fixturePath("display-p3.jpg"), {});

      expect(warningCodes(result)).toEqual(["W_NO_RIGHTS"]);
      expect(result.outputs[0]?.rights).toBeUndefined();
    });

    it("warns when the only field is Digital Source Type", async () => {
      const jpeg = await readFile(fixturePath("display-p3.jpg"));
      const digitalSourceType =
        "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
      const packet = buildRightsPacket({ digitalSourceType });
      const input = path.join(folder, "generated.jpg");

      await writeFile(input, setRights(jpeg, "jpeg", packet));

      const result = await optimise(input, {});

      expect(result.outputs[0]?.rights).toEqual({ digitalSourceType });
      expect(warningCodes(result)).toEqual(["W_NO_RIGHTS"]);
    });

    it("doesn't warn with stripAll, or for an SVG", async () => {
      const stripped = await optimise(fixturePath("display-p3.jpg"), {
        stripAll: true,
      });
      const svg = await optimise(fixturePath("title-viewbox.svg"), {
        to: "same",
      });

      expect(warningCodes(stripped)).toEqual([]);
      expect(warningCodes(svg)).toEqual([]);
      expect(svg.outputs[0]?.rights).toBeUndefined();
    });
  });

  describe("sizes", () => {
    it("drops a file's own rights rather than keep its other metadata when they don't fit", async () => {
      const noise = Buffer.alloc(64 * 64 * 3);

      for (let index = 0; index < noise.length; index++) {
        noise[index] = (index * 7919) % 251;
      }

      const jpeg = await sharp(noise, {
        raw: { width: 64, height: 64, channels: 3 },
      })
        .jpeg({ quality: 60, mozjpeg: true })
        .withExif({
          IFD0: { Artist: "Exif Artist" },
          IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" },
        })
        .toBuffer(); // the xmp packet is larger than the exif it replaces
      const input = path.join(folder, "gps.jpg");

      await writeFile(input, jpeg);

      const result = await optimise(input, { to: "same" });
      const [info] = await inspectOutputs(result);

      expect(result.outputs[0]?.bytes).toBeLessThan(jpeg.length);
      expect(result.outputs[0]?.rights).toBeUndefined();
      expect(info).toMatchObject({ metadata: [], rights: {} });
      expect(result.warnings).toEqual([
        {
          code: "W_RIGHTS_NOT_ADDED",
          message:
            "The Creator would have made the JPEG larger than the original, so it was left out",
        },
      ]);
    });

    it("keeps an input that holds nothing but its rights", async () => {
      const webp = await readFile(fixturePath("lossless.webp"));
      const { bytes: stripped } = stripLossless(webp, {
        format: "webp",
        orientation: 1,
      });
      const packet = buildRightsPacket(readRights(webp, "webp"));
      const input = path.join(folder, "credited.webp");

      await writeFile(input, setRights(stripped, "webp", packet));

      const kept = await optimise(input, { to: "same" });
      const added = await optimise(input, {
        to: "same",
        rights: { copyright: "Copyright Example" },
      });

      expect(kept).toMatchObject({ status: "kept-original", warnings: [] });
      expect(added.status).toBe("kept-original");
      expect(added.warnings).toEqual([
        {
          code: "W_RIGHTS_NOT_ADDED",
          message:
            "The file was kept as it is, so the Copyright Notice wasn't added",
        },
      ]);
    });

    it.each([
      ["same", "kept-original", []],
      ["webp", "optimised", ["webp"]],
      ["suite", "optimised", ["webp", "png"]],
    ] as const)(
      "writes nothing larger than the input for added fields in %s mode",
      async (to, status, formats) => {
        const icon = await readFile(fixturePath("icon-6x6.png"));
        const input = path.join(folder, "clean-icon.png");
        const clean = stripLossless(icon, {
          format: "png",
          orientation: 1,
        }).bytes; // nothing left to strip

        await writeFile(input, clean);

        const result = await optimise(input, {
          to,
          rights: { copyright: "Copyright Example" },
        });

        expect(result.status).toBe(status);
        expect(result.outputs.map((output) => output.format)).toEqual(formats);
        for (const output of result.outputs) {
          expect(output.bytes).toBeLessThanOrEqual(clean.length);
          expect(output.rights).toBeUndefined();
        }
        expect(warningCodes(result)).toEqual([
          "W_TOO_SMALL_TO_SCORE",
          "W_RIGHTS_NOT_ADDED",
        ]);
      }
    );

    it("leaves out fields a JPEG segment can't hold", async () => {
      const result = await optimise(fixturePath("orientation-6.jpg"), {
        to: "same",
        rights: { credit: "Example Library", copyright: "x".repeat(70_000) },
      });

      expect(result.outputs[0]).toMatchObject({
        format: "jpeg",
        rights: { creator: ["Fixture Author"] },
      });
      expect(warningCodes(result)).toEqual(["W_RIGHTS_NOT_ADDED"]);
    });
  });

  describe("options", () => {
    it.each<PipelineOptions>([
      { rights: { creator: "  " } },
      { rights: { rightsUrl: "example.com/licence" } },
      { rights: { licensorUrl: "ftp://example.com/buy" } },
      { stripAll: true, rights: { credit: "Example" } },
    ])("rejects %j", async (options) => {
      await expect(
        optimiseFile(fixturePath("icon-6x6.png"), options)
      ).rejects.toThrow(RangeError);
    });

    it("echoes the options, trimmed", async () => {
      const result = await optimiseBatch(
        [fixturePath("icon-6x6.png")],
        {
          rights: { credit: " Example ", rightsUrl: "https://example.com/l" },
          dryRun: true,
        },
        { concurrency: 1 }
      );

      expect(result.options).toMatchObject({
        stripAll: false,
        rights: { credit: "Example", rightsUrl: "https://example.com/l" },
      });
    });
  });
});
