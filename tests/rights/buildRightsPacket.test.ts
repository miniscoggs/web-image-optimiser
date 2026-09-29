import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildRightsPacket, readRights } from "../../src/rights/index.js";
import type { ImageRights } from "../../src/rights/index.js";
import { jpegWith, xmpSegment } from "./carriers.js";

/**
 * Returns the rights read back from a JPEG carrying a packet.
 *
 * @param packet - The packet.
 */
async function readBack(packet: Buffer | undefined) {
  if (packet === undefined) {
    throw new Error("No packet was built");
  }
  return readRights(await jpegWith([xmpSegment(packet)]), "jpeg");
}

describe("buildRightsPacket", () => {
  it("round-trips every field through readRights, escaping what XML needs", async () => {
    const rights: ImageRights = {
      creator: ["Ada & Grace", "José <Núñez>"],
      credit: 'The "Agency" & Co',
      copyright: [
        { lang: "x-default", value: "Copyright <Ada> & 'Grace'" },
        { lang: "de", value: "Urheberrecht Ada" },
      ],
      webStatement: "https://example.com/licence?a=1&b=2",
      licensorUrl: ["https://example.com/buy", "https://example.com/<2>"],
      digitalSourceType:
        "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    };

    expect(await readBack(buildRightsPacket(rights))).toEqual(rights);
  });

  it("builds a packet sharp reads as XMP", async () => {
    const packet = buildRightsPacket({ creator: ["Ada"] });
    const jpeg = await jpegWith(packet ? [xmpSegment(packet)] : []);

    expect((await sharp(jpeg).metadata()).xmp).toEqual(packet);
  });

  it("declares only the namespaces it uses, with no padding", () => {
    const packet = buildRightsPacket({ credit: "Agency" })?.toString();

    expect(packet).toContain(
      'xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:Credit="Agency"/>'
    );
    expect(packet).not.toContain("xmlns:dc");
    expect(packet).not.toMatch(/\s{2}/);
    expect(packet).toMatch(/<\?xpacket end="w"\?>$/);
  });

  it("drops characters XML can't hold", async () => {
    const bell = String.fromCharCode(7);
    const packet = buildRightsPacket({ credit: `Age${bell}ncy` });

    expect(await readBack(packet)).toEqual({ credit: "Agency" });
  });

  it("keeps tabs and line breaks, in attributes and elements", async () => {
    const rights: ImageRights = {
      creator: ["Ada\r\nGrace"],
      credit: "Line one\r\nLine two\tend",
      copyright: [{ lang: "x-default", value: "Copyright\rAda" }],
    };

    expect(await readBack(buildRightsPacket(rights))).toEqual(rights);
  });

  it("builds nothing for rights with no fields", () => {
    expect(buildRightsPacket({})).toBeUndefined();
  });
});
