import { describe, expect, it } from "vitest";
import readAppOptions from "../../src/app/appOptions.js";

describe("readAppOptions", () => {
  it("keeps every field a run takes, trimming the rights", () => {
    expect(
      readAppOptions({
        maxWidth: 1200,
        stripAll: true,
        rights: {
          creator: " Ada Lovelace ",
          credit: "Analytical Engines",
          copyright: "(c) 1843 Ada Lovelace",
          rightsUrl: "https://example.com/licence",
          licensorUrl: "http://example.com/",
        },
      })
    ).toEqual({
      maxWidth: 1200,
      stripAll: true,
      rights: {
        creator: "Ada Lovelace",
        credit: "Analytical Engines",
        copyright: "(c) 1843 Ada Lovelace",
        rightsUrl: "https://example.com/licence",
        licensorUrl: "http://example.com/",
      },
    });
  });

  it("drops each field a run wouldn't take, keeping the others", () => {
    expect(
      readAppOptions({
        maxWidth: 1.5,
        stripAll: "yes",
        rights: {
          creator: "  ",
          credit: 42,
          copyright: "(c) Ada",
          rightsUrl: "example.com/licence",
          licensorUrl: "ftp://example.com/",
          website: "https://example.com/",
        },
        theme: "dark",
      })
    ).toEqual({ stripAll: false, rights: { copyright: "(c) Ada" } });
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["text", "{}"],
    ["a list", [{ stripAll: true }]],
  ])("starts afresh from %s", (_name, value) => {
    expect(readAppOptions(value)).toEqual({ stripAll: false, rights: {} });
  });

  it.each([0, -800, 800.5, "800", Number.POSITIVE_INFINITY])(
    "drops a maximum width of %s",
    (maxWidth) => {
      expect(readAppOptions({ maxWidth })).not.toHaveProperty("maxWidth");
    }
  );
});
