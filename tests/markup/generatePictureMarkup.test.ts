import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatePictureMarkup } from "../../src/markup/index.js";
import type {
  PipelineFileResult,
  PipelineOutput,
} from "../../src/pipeline/index.js";

/**
 * Builds an output of a suite run for the markup, which reads only its role, format and path.
 *
 * @param role - The output's role.
 * @param format - Its format.
 * @param file - Its path.
 */
function output(
  role: PipelineOutput["role"],
  format: PipelineOutput["format"],
  file: string
): PipelineOutput {
  return {
    role,
    path: file,
    format,
    method: "lossy",
    quality: 70,
    bytes: 1000,
    saving: 0.5,
    score: 85,
    verdict: "excellent",
    strippedMetadata: [],
  };
}

/**
 * Builds an optimised file's result with the given outputs.
 *
 * @param outputs - The outputs.
 */
function optimised(outputs: PipelineOutput[]): PipelineFileResult {
  return {
    input: "hero.jpg",
    status: "optimised",
    bytes: 2000,
    width: 1600,
    height: 1067,
    outputs,
    warnings: [],
  };
}

const IMG_ATTRIBUTES =
  'width="1600" height="1067" alt="TODO: describe image" loading="lazy" decoding="async"';

describe("generatePictureMarkup", () => {
  it("gives a source for AVIF and WebP and an img for the fallback", () => {
    const file = optimised([
      output("avif", "avif", "hero.avif"),
      output("webp", "webp", "hero.webp"),
      output("fallback", "jpeg", "hero.jpg"),
    ]);

    expect(generatePictureMarkup(file)).toBe(
      [
        "<picture>",
        '  <source type="image/avif" srcset="hero.avif">',
        '  <source type="image/webp" srcset="hero.webp">',
        `  <img src="hero.jpg" ${IMG_ATTRIBUTES}>`,
        "</picture>",
      ].join("\n")
    );
  });

  it("leaves out AVIF when the chain dropped it", () => {
    const file = optimised([
      output("webp", "webp", "hero.webp"),
      output("fallback", "png", "hero.png"),
    ]);

    expect(generatePictureMarkup(file)).toBe(
      [
        "<picture>",
        '  <source type="image/webp" srcset="hero.webp">',
        `  <img src="hero.png" ${IMG_ATTRIBUTES}>`,
        "</picture>",
      ].join("\n")
    );
  });

  it("gives just an img for a fallback on its own", () => {
    const file = optimised([output("fallback", "jpeg", "hero.jpg")]);

    expect(generatePictureMarkup(file)).toBe(
      `<img src="hero.jpg" ${IMG_ATTRIBUTES}>`
    );
  });

  it("uses the last output as the img when there is no fallback", () => {
    const file = optimised([
      output("avif", "avif", "hero.avif"),
      output("webp", "webp", "hero.webp"),
    ]); // eg a lossy WebP source, which no JPEG or PNG beats

    expect(generatePictureMarkup(file)).toBe(
      [
        "<picture>",
        '  <source type="image/avif" srcset="hero.avif">',
        `  <img src="hero.webp" ${IMG_ATTRIBUTES}>`,
        "</picture>",
      ].join("\n")
    );
  });

  it("shows a kept-original file's input", () => {
    const file: PipelineFileResult = {
      ...optimised([]),
      status: "kept-original",
    };

    expect(generatePictureMarkup(file)).toBe(
      `<img src="hero.jpg" ${IMG_ATTRIBUTES}>`
    );
  });

  it("gives nothing for a failed or skipped file", () => {
    for (const status of ["failed", "skipped"] as const) {
      expect(
        generatePictureMarkup({ ...optimised([]), status })
      ).toBeUndefined();
    }
  });

  it("makes URLs relative to the root, with / separators and each part encoded", () => {
    const root = path.join("site", "web");
    const file = optimised([
      output("webp", "webp", path.join(root, "blog", "my photo é.webp")),
      output("fallback", "jpeg", path.join(root, "blog", "my photo é.jpg")),
    ]);

    expect(generatePictureMarkup(file, { root })).toContain(
      'srcset="blog/my%20photo%20%C3%A9.webp"'
    );
    expect(generatePictureMarkup(file, { root })).toContain(
      'src="blog/my%20photo%20%C3%A9.jpg"'
    );
  });

  it("leaves out width and height when they aren't known", () => {
    const file = {
      ...optimised([output("fallback", "png", "logo.png")]),
      width: undefined,
      height: undefined,
    };

    expect(generatePictureMarkup(file)).toBe(
      '<img src="logo.png" alt="TODO: describe image" loading="lazy" decoding="async">'
    );
  });
});
