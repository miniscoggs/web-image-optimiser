import { describe, expect, it } from "vitest";
import { readRights } from "../../src/rights/index.js";
import type { StripFormat } from "../../src/strip/index.js";
import {
  exifBlock,
  exifSegment,
  iimSegments,
  jpegWith,
  pngChunk,
  pngTextChunk,
  pngWith,
  renderImage,
  xmpPacket,
  xmpSegment,
} from "./carriers.js";
import type { IimDataset } from "./carriers.js";

const NAMESPACES = [
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"',
  'xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"',
  'xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/"',
  'xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"',
].join(" ");
const AI_SOURCE =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const FULL_PACKET = xmpPacket(
  `<rdf:Description rdf:about="" ${NAMESPACES} photoshop:Credit="Agency" xmpRights:WebStatement="https://example.com/licence">` +
    "<dc:creator><rdf:Seq><rdf:li>Ada</rdf:li><rdf:li>Grace</rdf:li></rdf:Seq></dc:creator>" +
    '<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Copyright Ada</rdf:li></rdf:Alt></dc:rights>' +
    '<plus:Licensor><rdf:Bag><rdf:li rdf:parseType="Resource"><plus:LicensorURL>https://example.com/buy</plus:LicensorURL></rdf:li></rdf:Bag></plus:Licensor>' +
    `<Iptc4xmpExt:DigitalSourceType>${AI_SOURCE}</Iptc4xmpExt:DigitalSourceType>` +
    "</rdf:Description>"
);
const FULL_RIGHTS = {
  creator: ["Ada", "Grace"],
  credit: "Agency",
  copyright: [{ lang: "x-default", value: "Copyright Ada" }],
  webStatement: "https://example.com/licence",
  licensorUrl: ["https://example.com/buy"],
  digitalSourceType: AI_SOURCE,
};
const FORMATS: StripFormat[] = ["jpeg", "png", "webp", "avif"];
const IIM_UTF8 = Buffer.from([0x1b, 0x25, 0x47]); // ESC % G

/**
 * Builds a packet with one description holding the given properties.
 *
 * @param properties - The description's attributes and content, eg `>...</rdf:Description>`.
 */
function packetWith(properties: string) {
  return xmpPacket(`<rdf:Description rdf:about="" ${NAMESPACES}${properties}`);
}

/**
 * Builds a packet whose only field is one Creator.
 *
 * @param name - The Creator.
 */
function creatorPacket(name: string) {
  return packetWith(
    `><dc:creator><rdf:Seq><rdf:li>${name}</rdf:li></rdf:Seq></dc:creator></rdf:Description>`
  );
}

/**
 * Returns the rights of a JPEG carrying the given segments.
 *
 * @param segments - Complete segments.
 */
async function jpegRights(segments: Buffer[]) {
  return readRights(await jpegWith(segments), "jpeg");
}

/**
 * Returns the rights of a JPEG carrying one XMP packet.
 *
 * @param packet - The packet.
 */
function xmpRights(packet: string | Buffer) {
  return jpegRights([xmpSegment(packet)]);
}

describe("readRights", () => {
  describe("in each format", () => {
    it.each(FORMATS)("reads sharp's XMP in a %s", async (format) => {
      const bytes = await renderImage()
        .withXmp(FULL_PACKET)
        .toFormat(format)
        .toBuffer();

      expect(readRights(bytes, format)).toEqual(FULL_RIGHTS);
    });

    it.each(FORMATS)(
      "reads sharp's EXIF Artist and Copyright in a %s",
      async (format) => {
        const bytes = await renderImage()
          .withExif({ IFD0: { Artist: "Ada", Copyright: "Copyright Ada" } })
          .toFormat(format)
          .toBuffer();

        expect(readRights(bytes, format)).toEqual({
          creator: ["Ada"],
          copyright: [{ lang: "x-default", value: "Copyright Ada" }],
        });
      }
    );

    it.each([
      ["a tEXt", pngTextChunk("tEXt", "XML:com.adobe.xmp", FULL_PACKET)],
      ["an iTXt", pngTextChunk("iTXt", "XML:com.adobe.xmp", FULL_PACKET)],
      [
        "a compressed iTXt",
        pngTextChunk("iTXt", "XML:com.adobe.xmp", FULL_PACKET, true),
      ],
    ])("reads XMP from %s chunk in a PNG", async (_, chunk) => {
      expect(readRights(await pngWith([chunk]), "png")).toEqual(FULL_RIGHTS);
    });

    it("gives nothing for an image without carriers", async () => {
      const png = await renderImage().png().toBuffer();

      expect(readRights(png, "png")).toEqual({});
    });

    it("gives nothing, rather than throwing, when the file's structure is broken", async () => {
      const avif = await renderImage().withXmp(FULL_PACKET).avif().toBuffer();

      expect(readRights(avif.subarray(0, 40), "avif")).toEqual({});
    });
  });

  describe("the order of carriers", () => {
    const xmp = xmpSegment(creatorPacket("XMP"));
    const iim = iimSegments([[2, 80, Buffer.from("IIM")]]);
    const exif = exifSegment(exifBlock({ artist: Buffer.from("EXIF\0") }));

    it.each([
      ["XMP", [xmp, ...iim, exif]],
      ["IIM", [...iim, exif]],
      ["EXIF", [exif]],
    ])("takes the Creator from %s first", async (creator, segments) => {
      expect(await jpegRights(segments)).toEqual({ creator: [creator] });
    });

    it("fills each field from the first carrier that has it", async () => {
      const rights = await jpegRights([
        xmp,
        ...iimSegments([
          [2, 80, Buffer.from("IIM")],
          [2, 110, Buffer.from("IIM credit")],
        ]),
        exifSegment(
          exifBlock({
            artist: Buffer.from("EXIF\0"),
            copyright: Buffer.from("EXIF copyright\0"),
          })
        ),
      ]);

      expect(rights).toEqual({
        creator: ["XMP"],
        credit: "IIM credit",
        copyright: [{ lang: "x-default", value: "EXIF copyright" }],
      });
    });

    it("prefers a PNG's XMP, then its EXIF, then its text chunks", async () => {
      const png = await pngWith([
        pngTextChunk("tEXt", "Author", "Text author"),
        pngTextChunk("tEXt", "Copyright", "Text copyright"),
        pngChunk(
          "eXIf",
          exifBlock({
            artist: Buffer.from("EXIF\0"),
            copyright: Buffer.from("EXIF copyright\0"),
          })
        ),
        pngTextChunk("iTXt", "XML:com.adobe.xmp", creatorPacket("XMP")),
      ]);

      expect(readRights(png, "png")).toEqual({
        creator: ["XMP"],
        copyright: [{ lang: "x-default", value: "EXIF copyright" }],
      });
    });
  });

  describe("PNG text", () => {
    it.each([
      ["tEXt", "zTXt"],
      ["zTXt", "iTXt"],
    ] as const)(
      "reads Author from %s and Copyright from %s",
      async (authorType, copyrightType) => {
        const png = await pngWith([
          pngTextChunk(authorType, "Author", "José Núñez"),
          pngTextChunk(copyrightType, "Copyright", "Copyright José"),
        ]);

        expect(readRights(png, "png")).toEqual({
          creator: ["José Núñez"],
          copyright: [{ lang: "x-default", value: "Copyright José" }],
        });
      }
    );

    it("reads a compressed iTXt as UTF-8", async () => {
      const png = await pngWith([
        pngTextChunk("iTXt", "Author", "José Núñez", true),
      ]);

      expect(readRights(png, "png")).toEqual({ creator: ["José Núñez"] });
    });
  });

  describe("EXIF", () => {
    it.each([
      ["both notices, joined", "Photographer\0Editor\0", "Photographer Editor"],
      ["the editor's notice alone", " \0Editor\0", "Editor"],
    ])("reads %s from Copyright", async (_, copyright, expected) => {
      const rights = await jpegRights([
        exifSegment(exifBlock({ copyright: Buffer.from(copyright) })),
      ]);

      expect(rights).toEqual({
        copyright: [{ lang: "x-default", value: expected }],
      });
    });

    it("reads a value short enough to sit in its entry", async () => {
      const rights = await jpegRights([
        exifSegment(exifBlock({ artist: Buffer.from("Al\0") })),
      ]);

      expect(rights).toEqual({ creator: ["Al"] });
    });

    it("decodes text as UTF-8, or as Latin-1 when it isn't valid UTF-8", async () => {
      const rights = await jpegRights([
        exifSegment(
          exifBlock({
            artist: Buffer.from("José\0"),
            copyright: Buffer.from("Núñez\0", "latin1"),
          })
        ),
      ]);

      expect(rights).toEqual({
        creator: ["José"],
        copyright: [{ lang: "x-default", value: "Núñez" }],
      });
    });
  });

  describe("IPTC IIM", () => {
    const datasets = (encode: (text: string) => Buffer): IimDataset[] => [
      [2, 0, Buffer.from([0, 4])],
      [2, 80, encode("José")],
      [2, 80, encode("Núñez")],
      [2, 110, encode("Agency")],
      [2, 116, encode("Copyright José")],
    ];
    const expected = {
      creator: ["José", "Núñez"],
      credit: "Agency",
      copyright: [{ lang: "x-default", value: "Copyright José" }],
    };

    it("reads every By-line, Credit and Copyright Notice as UTF-8 when 1:90 declares it", async () => {
      const rights = await jpegRights(
        iimSegments([
          [1, 90, IIM_UTF8],
          ...datasets((text) => Buffer.from(text)),
        ])
      );

      expect(rights).toEqual(expected);
    });

    it("reads text as Latin-1 when nothing declares UTF-8", async () => {
      const rights = await jpegRights(
        iimSegments(datasets((text) => Buffer.from(text, "latin1")))
      );

      expect(rights).toEqual(expected);
    });

    it("joins resources split across APP13 segments", async () => {
      const rights = await jpegRights(
        iimSegments(
          datasets((text) => Buffer.from(text, "latin1")),
          3
        )
      );

      expect(rights).toEqual(expected);
    });

    it("reads past a dataset with an extended length", async () => {
      const rights = await jpegRights(
        iimSegments([
          [2, 202, Buffer.alloc(40_000)],
          [2, 80, Buffer.from("Ada")],
        ])
      );

      expect(rights).toEqual({ creator: ["Ada"] });
    });
  });

  describe("XMP", () => {
    it("matches properties by namespace URI, whatever the prefix", async () => {
      const packet = xmpPacket(
        '<rdf:Description rdf:about="" xmlns:d="http://purl.org/dc/elements/1.1/">' +
          "<d:creator><rdf:Seq><rdf:li>Ada</rdf:li></rdf:Seq></d:creator>" +
          '<Credit xmlns="http://ns.adobe.com/photoshop/1.0/">Agency</Credit>' +
          "</rdf:Description>"
      );

      expect(await xmpRights(packet)).toEqual({
        creator: ["Ada"],
        credit: "Agency",
      });
    });

    it("ignores a usual prefix bound to another namespace", async () => {
      const packet = xmpPacket(
        '<rdf:Description rdf:about="" xmlns:dc="http://example.com/not-dc/" dc:rights="Copyright Ada"/>'
      );

      expect(await xmpRights(packet)).toEqual({});
    });

    it("reads simple values from attributes and elements alike", async () => {
      const packet = packetWith(
        ` dc:creator="Ada" dc:rights="Copyright Ada" Iptc4xmpExt:DigitalSourceType="${AI_SOURCE}">` +
          "<photoshop:Credit>Agency</photoshop:Credit>" +
          "<xmpRights:WebStatement>https://example.com/licence</xmpRights:WebStatement>" +
          "</rdf:Description>"
      );

      expect(await xmpRights(packet)).toEqual({
        creator: ["Ada"],
        credit: "Agency",
        copyright: [{ lang: "x-default", value: "Copyright Ada" }],
        webStatement: "https://example.com/licence",
        digitalSourceType: AI_SOURCE,
      });
    });

    it("reads properties spread over several descriptions", async () => {
      const packet = xmpPacket(
        '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="Ada"/>' +
          '<rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:Credit="Agency"/>'
      );

      expect(await xmpRights(packet)).toEqual({
        creator: ["Ada"],
        credit: "Agency",
      });
    });

    it("puts the x-default copyright first, keeping every language", async () => {
      const packet = packetWith(
        "><dc:rights><rdf:Alt>" +
          '<rdf:li xml:lang="de">Urheberrecht Ada</rdf:li>' +
          '<rdf:li xml:lang="x-default">Copyright Ada</rdf:li>' +
          '<rdf:li xml:lang="fr">Droit d\'auteur Ada</rdf:li>' +
          "</rdf:Alt></dc:rights></rdf:Description>"
      );

      expect(await xmpRights(packet)).toEqual({
        copyright: [
          { lang: "x-default", value: "Copyright Ada" },
          { lang: "de", value: "Urheberrecht Ada" },
          { lang: "fr", value: "Droit d'auteur Ada" },
        ],
      });
    });

    it("reads Licensor URLs from each form of structure", async () => {
      const packet = packetWith(
        "><plus:Licensor><rdf:Seq>" +
          '<rdf:li rdf:parseType="Resource"><plus:LicensorURL>https://example.com/1</plus:LicensorURL></rdf:li>' +
          '<rdf:li><rdf:Description plus:LicensorURL="https://example.com/2"/></rdf:li>' +
          '<rdf:li plus:LicensorURL="https://example.com/3"/>' +
          "</rdf:Seq></plus:Licensor></rdf:Description>"
      );

      expect(await xmpRights(packet)).toEqual({
        licensorUrl: [
          "https://example.com/1",
          "https://example.com/2",
          "https://example.com/3",
        ],
      });
    });

    it("reads a packet with a byte order mark and trailing null padding", async () => {
      const byteOrderMark = String.fromCharCode(0xfeff);
      const packet = `${byteOrderMark}${creatorPacket("Ada")}\0\0\0`;

      expect(await xmpRights(packet)).toEqual({ creator: ["Ada"] });
    });

    it.each([
      ["unclosed", creatorPacket("Ada").slice(0, -12)],
      ["with an unbound prefix", "<x:xmpmeta/>"],
      ["not XML", "not xml"],
    ])(
      "ignores a packet that is %s, reading the other carriers",
      async (_, packet) => {
        const rights = await jpegRights([
          xmpSegment(packet),
          exifSegment(exifBlock({ artist: Buffer.from("EXIF\0") })),
        ]);

        expect(rights).toEqual({ creator: ["EXIF"] });
      }
    );
  });

  describe("values", () => {
    it("trims values and drops those left empty, so the next carrier fills them", async () => {
      const rights = await jpegRights([
        xmpSegment(
          packetWith(
            ' photoshop:Credit="  ">' +
              "<dc:creator><rdf:Seq><rdf:li> </rdf:li><rdf:li>\n Ada \n</rdf:li></rdf:Seq></dc:creator>" +
              "</rdf:Description>"
          )
        ),
        ...iimSegments([[2, 110, Buffer.from("Agency\0")]]),
      ]);

      expect(rights).toEqual({ creator: ["Ada"], credit: "Agency" });
    });

    it("drops the characters XML can't hold, as the packet would", async () => {
      const rights = await jpegRights(
        iimSegments([[2, 110, Buffer.from("Age\u0007ncy\u0001")]])
      );

      expect(rights).toEqual({ credit: "Agency" });
    });
  });
});
