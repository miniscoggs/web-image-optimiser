import { describe, expect, it } from "vitest";
import { mergeRights } from "../../src/rights/index.js";

const FILE_COPYRIGHT = [
  { lang: "x-default", value: "Copyright Ada" },
  { lang: "de", value: "Urheberrecht Ada" },
];

describe("mergeRights", () => {
  it("fills only the fields the file lacks", () => {
    const merged = mergeRights(
      { creator: ["Ada"], copyright: FILE_COPYRIGHT },
      {
        creator: ["Added"],
        credit: "Agency",
        copyright: [{ lang: "x-default", value: "Added copyright" }],
        webStatement: "https://example.com/licence",
      }
    );

    expect(merged).toEqual({
      creator: ["Ada"],
      credit: "Agency",
      copyright: FILE_COPYRIGHT,
      webStatement: "https://example.com/licence",
    });
  });

  it("lists the fields in their usual order, whichever side they came from", () => {
    const merged = mergeRights(
      { digitalSourceType: "http://example.com/source", credit: "Agency" },
      { licensorUrl: ["https://example.com/buy"], creator: ["Ada"] }
    );

    expect(Object.keys(merged)).toEqual([
      "creator",
      "credit",
      "licensorUrl",
      "digitalSourceType",
    ]);
  });

  it("returns no fields when neither side has any", () => {
    expect(mergeRights({}, {})).toEqual({});
  });
});
