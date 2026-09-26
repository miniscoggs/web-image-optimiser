import { describe, expect, it } from "vitest";
import type { PipelineFileResult } from "../../src/pipeline/types.js";
import { cliCommand, markupText } from "../../ui/src/copyText.js";

const REFS = [
  "root/photo.jpg",
  "root/blog/hero shot.png",
  "root/it's.png",
  "root/price $5 %TEMP%.png",
  "root/-hero.png",
  "session/uploads/3/logo.svg",
];

describe("cliCommand", () => {
  it("names files as run from the folder served, quoting for a POSIX shell", () => {
    expect(
      cliCommand(REFS, { to: "suite", target: "excellent" }, "/home/me/site")
    ).toBe(
      "wio photo.jpg 'blog/hero shot.png' 'it'\\''s.png' 'price $5 %TEMP%.png' ./-hero.png logo.svg --to suite --target excellent"
    );
  });

  it("quotes for PowerShell when the folder is on Windows, and passes a score as it is", () => {
    for (const root of ["C:\\Users\\me\\site", "\\\\server\\share"]) {
      expect(
        cliCommand(
          [...REFS, "root/Lewis\u2019s.png"],
          { to: "webp", target: 82.5 },
          root
        )
      ).toBe(
        "wio photo.jpg 'blog/hero shot.png' 'it''s.png' 'price $5 %TEMP%.png' ./-hero.png logo.svg 'Lewis\u2019\u2019s.png' --to webp --target 82.5"
      );
    }
  });
});

describe("markupText", () => {
  it("lists each file's markup after a comment naming it, as the CLI prints it", () => {
    const file = (input: string, markup?: string): PipelineFileResult => ({
      input,
      status: "optimised",
      outputs: [],
      warnings: [],
      ...(markup === undefined ? {} : { markup }),
    });

    expect(
      markupText([
        file("root/blog/a.png", '<img src="blog/a.png">'),
        file("root/b.png"),
        file("session/uploads/1/c.jpg", '<img src="c.jpg">'),
      ])
    ).toBe(
      '<!-- blog/a.png -->\n<img src="blog/a.png">\n\n<!-- c.jpg -->\n<img src="c.jpg">\n'
    );
    expect(markupText([file("root/b.png")])).toBe("");
  });
});
