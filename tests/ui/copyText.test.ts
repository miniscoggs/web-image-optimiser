import { describe, expect, it } from "vitest";
import { cliBlockNote, cliCommand } from "../../ui/src/copyText.js";

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

describe("cliBlockNote", () => {
  it("counts the files the command would fail and skip, and names each in full", () => {
    const note = cliBlockNote([
      {
        ref: "root/blog/a.webp",
        running: false,
        cliBlock: { reason: "input", ref: "root/blog/a.webp" },
      },
      { ref: "root/b.png", running: false },
      {
        ref: "root/c.jpg",
        running: false,
        cliBlock: { reason: "input", ref: "root/c.jpg" },
      },
      {
        ref: "session/uploads/1/d.png",
        running: false,
        cliBlock: { reason: "exists", ref: "root/d.webp" },
      },
    ]);

    expect(note).toEqual({
      summary:
        "Run as copied, this command would fail 2 files, whose outputs replace their originals (add --in-place to allow it), and skip 1 file, whose output exists (add --overwrite to replace it):",
      lines: [
        { ref: "root/blog/a.webp", text: "blog/a.webp fails" },
        { ref: "root/c.jpg", text: "c.jpg fails" },
        {
          ref: "session/uploads/1/d.png",
          text: "d.png is skipped, as d.webp exists",
        },
      ],
    });
    expect(cliBlockNote([{ ref: "root/b.png", running: false }])).toBe(
      undefined
    );
  });
});
