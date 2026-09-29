import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import renderRun from "../../src/cli/renderRun.js";
import type { PipelineRunResult } from "../../src/pipeline/index.js";

const RESULT: PipelineRunResult = {
  schemaVersion: 1,
  tool: { version: "0.1.0", sharp: "0.35.4", libvips: "8.18.6" },
  options: {
    to: "suite",
    target: 80,
    inPlace: false,
    overwrite: false,
    dryRun: true,
    stripAll: false,
    concurrency: 2,
  },
  files: [
    {
      input: "hero.jpg",
      status: "optimised",
      bytes: 250_000,
      width: 1600,
      height: 1067,
      outputs: [
        {
          role: "avif",
          path: "hero.avif",
          format: "avif",
          width: 1600,
          height: 1067,
          method: "lossy",
          quality: 62,
          bytes: 48_200,
          saving: 0.8072,
          score: 80.44,
          verdict: "very-high",
          strippedMetadata: ["exif"],
        },
        {
          role: "fallback",
          path: "hero.jpg",
          format: "jpeg",
          width: 1600,
          height: 1067,
          method: "strip",
          bytes: 240_000,
          saving: 0.04,
          score: 100,
          verdict: "visually-lossless",
          strippedMetadata: ["exif"],
        },
      ],
      warnings: [
        { code: "W_ICC_KEPT", message: "The profile was kept" },
        { code: "W_NO_RIGHTS", message: "The image has no rights" },
      ],
    },
    {
      input: "anim.webp",
      status: "failed",
      bytes: 854,
      outputs: [],
      warnings: [],
      error: {
        code: "E_ANIMATED",
        message: "Animated images are not supported",
      },
    },
  ],
  totals: {
    files: 2,
    optimised: 1,
    keptOriginal: 0,
    skipped: 0,
    failed: 1,
    inputBytes: 250_000,
    outputBytes: 48_200,
    saving: 0.8072,
  },
};

describe("renderRun", () => {
  it("renders a table, a summary and the messages", () => {
    expect(renderRun(RESULT, false)).toBe(
      [
        "File       Output    Format  Quality               Size  Saving  Score  Verdict            Notes",
        "hero.jpg   avif      avif    q62      250 kB -> 48.2 kB   80.7%   80.4  very-high          W_ICC_KEPT",
        "           fallback  jpeg    strip     250 kB -> 240 kB    4.0%  100.0  visually-lossless",
        "anim.webp  failed                                 854 B                                    E_ANIMATED",
        "",
        "2 files: 1 optimised, 1 failed. 250 kB -> 48.2 kB, 80.7% smaller. Dry run: nothing was written.",
        "",
        "hero.jpg: W_ICC_KEPT The profile was kept",
        "anim.webp: E_ANIMATED Animated images are not supported",
        "W_NO_RIGHTS 1 file has no copyright or licence metadata (--creator, --credit, --copyright, --rights-url, --licensor-url or --strip-all)",
        "",
      ].join("\n")
    );
  });

  it("counts W_NO_RIGHTS once for the run, in place of each file's", () => {
    const files = RESULT.files
      .slice(0, 1)
      .flatMap((hero) => [hero, { ...hero, input: "hero-2.jpg" }]);
    const text = renderRun({ ...RESULT, files }, false);

    expect(text.match(/W_NO_RIGHTS/g)).toHaveLength(1);
    expect(text).toContain(
      "\nW_NO_RIGHTS 2 files have no copyright or licence metadata ("
    );
  });

  it("adds colour only when asked, and never trailing spaces", () => {
    const plain = renderRun(RESULT, false);
    const colored = renderRun(RESULT, true);

    expect(colored).not.toBe(plain);
    expect(stripVTControlCharacters(colored)).toBe(plain);
    expect(plain).not.toMatch(/ \n/);
  });
});
