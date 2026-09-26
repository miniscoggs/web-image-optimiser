/**
 * Options for {@link generatePictureMarkup}.
 *
 * @example
 * ```ts
 * import type { MarkupOptions } from "web-image-optimiser";
 *
 * const options: MarkupOptions = { root: "web" };
 * ```
 */
type MarkupOptions = {
  /** The folder the URLs are relative to, such as the output folder. Defaults to the paths as reported. */
  root?: string;
};

export type { MarkupOptions };
