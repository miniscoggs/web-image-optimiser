import path from "node:path";
import type { InspectFormat } from "../inspect/index.js";
import type { PipelineFileResult } from "../pipeline/index.js";
import type { MarkupOptions } from "./types.js";

const ALT_PLACEHOLDER = "TODO: describe image"; // only a person knows what the image is for

const MIME_TYPES = {
  avif: "image/avif",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
} as const satisfies Record<InspectFormat, string>;

/**
 * Turns a file path into a relative URL: `/` separators, each part percent-encoded.
 *
 * @param filePath - The path.
 * @param root - The folder it is relative to, if any.
 */
function toUrl(filePath: string, root: string | undefined) {
  const relative =
    root === undefined ? filePath : path.relative(root, filePath);
  const separators = path.sep === "\\" ? /[\\/]/ : "/";

  return relative
    .split(separators)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

/**
 * Generates the HTML that shows an optimised image: a `<picture>` with a `<source>` for each
 * output but the last, and an `<img>` for the last, which every browser can show. With one
 * output, it is just the `<img>`.
 *
 * The `<img>` carries the image's `width` and `height`, so the page doesn't shift as it loads,
 * `loading="lazy"`, `decoding="async"`, and `alt="TODO: describe image"`, since alt text must
 * come from someone who knows what the image is for. Remove `loading="lazy"` from an image that
 * is visible when the page opens. A kept-original file shows its input.
 *
 * @param file - A file's result, from {@link optimiseFile} or {@link optimiseBatch}.
 * @param options - `root` makes the URLs relative to a folder, such as the output folder.
 * @returns The HTML, or `undefined` when the file failed or was skipped.
 *
 * @example
 * ```ts
 * import { generatePictureMarkup, optimiseFile } from "web-image-optimiser";
 *
 * const result = await optimiseFile("hero.jpg", { to: "suite", outDir: "web" });
 * console.log(generatePictureMarkup(result, { root: "web" }));
 * ```
 */
function generatePictureMarkup(
  file: PipelineFileResult,
  options: MarkupOptions = {}
) {
  const size =
    file.width === undefined || file.height === undefined
      ? ""
      : ` width="${file.width}" height="${file.height}"`;
  const img = (imagePath: string) =>
    `<img src="${toUrl(imagePath, options.root)}"${size} alt="${ALT_PLACEHOLDER}" loading="lazy" decoding="async">`;

  if (file.status === "kept-original") {
    return img(file.input);
  }

  const fallback = file.outputs.at(-1);

  if (fallback === undefined) {
    return undefined;
  }

  const sources = file.outputs
    .slice(0, -1)
    .map(
      (output) =>
        `<source type="${MIME_TYPES[output.format]}" srcset="${toUrl(output.path, options.root)}">`
    );

  return sources.length === 0
    ? img(fallback.path)
    : ["<picture>", ...sources, img(fallback.path)]
        .join("\n  ")
        .concat("\n</picture>");
}

export default generatePictureMarkup;
