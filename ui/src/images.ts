import type { AppRightsResponse } from "../../src/app/api.js";
import type {
  PipelineFileResult,
  PipelineOutput,
} from "../../src/pipeline/types.js";

/**
 * Where an opened image has got to: waiting for a run, being worked on, finished or failed.
 */
type ImageStatus = "queued" | "processing" | "done" | "failed";

/**
 * An opened image, and its result once its run has finished it. The result's outputs and
 * warnings follow the metadata options in force, which change after the run. `replaced` is set
 * once a save has replaced the original, so the result is of the old one.
 */
type OpenedImage = {
  ref: string;
  name: string;
  bytes: number;
  status: ImageStatus;
  result?: PipelineFileResult;
  error?: string;
  replaced?: boolean;
};

/**
 * A change to the opened images.
 */
type ImagesAction =
  | { type: "add"; files: Pick<OpenedImage, "ref" | "name" | "bytes">[] }
  | { type: "replaced"; ref: string }
  | { type: "requeue" }
  | { type: "start"; ref: string }
  | { type: "finish"; result: PipelineFileResult }
  | { type: "fail"; refs: string[]; error: string }
  | { type: "rights"; rewritten: RewrittenImage[] };

/**
 * An image's outputs after a rights rewrite, in the result's output order, with the warnings
 * the rewrite gave.
 */
type RewrittenImage = {
  ref: string;
  candidates: AppRightsResponse["candidates"];
};

const RIGHTS_WARNING_CODES = new Set(["W_NO_RIGHTS", "W_RIGHTS_NOT_ADDED"]);

/**
 * Changes one image.
 *
 * @param images - The images.
 * @param ref - The image's ref.
 * @param change - Returns what changes.
 */
function updateImage(
  images: OpenedImage[],
  ref: string,
  change: (image: OpenedImage) => Partial<OpenedImage>
) {
  return images.map((image) =>
    image.ref === ref ? { ...image, ...change(image) } : image
  );
}

/**
 * Returns the outputs and warnings a result has once its outputs are rewritten: the rewritten
 * files, sizes and savings, and the rights warnings the rewrite gave in place of the run's.
 *
 * @param result - The result.
 * @param candidates - The rewrite's response for the result's outputs, in order.
 */
function rewritten(
  result: PipelineFileResult,
  candidates: AppRightsResponse["candidates"]
): PipelineFileResult {
  const outputs = result.outputs.map((output, index): PipelineOutput => {
    const candidate = candidates[index];

    return candidate === undefined
      ? output
      : {
          ...output,
          path: candidate.ref,
          bytes: candidate.bytes,
          saving: candidate.saving,
        };
  });
  const fresh = candidates
    .flatMap((candidate) => candidate.warnings)
    .filter(
      (warning, index, all) =>
        all.findIndex(
          (other) =>
            other.code === warning.code && other.message === warning.message
        ) === index
    );

  return {
    ...result,
    outputs,
    warnings: [
      ...result.warnings.filter(
        (warning) => !RIGHTS_WARNING_CODES.has(warning.code)
      ),
      ...fresh,
    ],
  };
}

/**
 * Returns the opened images after a change. Opening an image that is already open changes
 * nothing, unless a save has replaced its original, when the new file is queued to run.
 *
 * @param images - The images.
 * @param action - The change.
 */
function imagesReducer(images: OpenedImage[], action: ImagesAction) {
  switch (action.type) {
    case "add": {
      const opened = new Map(action.files.map((file) => [file.ref, file]));
      const known = new Set(images.map((image) => image.ref));
      const added = [...opened.values()]
        .filter((file) => !known.has(file.ref))
        .map((file): OpenedImage => ({ ...file, status: "queued" }));
      const reopened = images.some(
        (image) => image.replaced === true && opened.has(image.ref)
      );

      if (added.length === 0 && !reopened) {
        return images;
      }
      return [
        ...images.map((image): OpenedImage => {
          const file = opened.get(image.ref);

          return file !== undefined && image.replaced === true
            ? { ...file, status: "queued" }
            : image;
        }),
        ...added,
      ];
    }
    case "replaced":
      return updateImage(images, action.ref, () => ({ replaced: true }));
    case "requeue":
      return images.map(({ ref, name, bytes }): OpenedImage => ({
        ref,
        name,
        bytes,
        status: "queued",
      }));
    case "start":
      return updateImage(images, action.ref, () => ({
        status: "processing",
      }));
    case "finish": {
      const { result } = action;

      return updateImage(images, result.input, () =>
        result.status === "failed"
          ? {
              status: "failed",
              result,
              error: result.error?.message ?? "The image failed",
            }
          : { status: "done", result }
      );
    }
    case "fail":
      return images.map((image): OpenedImage =>
        action.refs.includes(image.ref) &&
        (image.status === "queued" || image.status === "processing")
          ? { ...image, status: "failed", error: action.error }
          : image
      );
    case "rights":
      return action.rewritten.reduce(
        (current, { ref, candidates }) =>
          updateImage(current, ref, ({ result }) =>
            result === undefined
              ? {}
              : { result: rewritten(result, candidates) }
          ),
        images
      );
  }
}

/**
 * Returns the refs still to run.
 *
 * @param images - The images.
 */
function queuedRefs(images: OpenedImage[]) {
  return images
    .filter((image) => image.status === "queued")
    .map((image) => image.ref);
}

export { imagesReducer, queuedRefs };
export type { ImageStatus, ImagesAction, OpenedImage, RewrittenImage };
