import { describe, expect, it } from "vitest";
import { imagesReducer, queuedRefs } from "../../ui/src/images.js";
import type { OpenedImage } from "../../ui/src/images.js";
import { suiteResult } from "./results.js";

const FILE = { ref: "root/photos/cat.png", name: "cat.png", bytes: 100_000 };

describe("imagesReducer", () => {
  it("adds images once each, queued", () => {
    const added = imagesReducer([], { type: "add", files: [FILE, FILE] });

    expect(added).toEqual([{ ...FILE, status: "queued" }]);
    expect(imagesReducer(added, { type: "add", files: [FILE] })).toBe(added);
  });

  it("runs an image opened again only once a save has replaced its original", () => {
    const done = [{ ...FILE, status: "done" as const, result: suiteResult() }];
    const replaced = imagesReducer(done, { type: "replaced", ref: FILE.ref });
    const reopened = imagesReducer(replaced, {
      type: "add",
      files: [{ ...FILE, bytes: 60_000 }],
    });

    expect(imagesReducer(done, { type: "add", files: [FILE] })).toBe(done);
    expect(replaced[0]?.replaced).toBe(true);
    expect(reopened).toEqual([{ ...FILE, bytes: 60_000, status: "queued" }]);
  });

  it("forgets a replaced original when every image runs again", () => {
    const images = imagesReducer(
      [{ ...FILE, status: "done", result: suiteResult(), replaced: true }],
      { type: "requeue" }
    );

    expect(images[0]?.replaced).toBeUndefined();
  });

  it("moves an image from queued to processing to done with its result", () => {
    const result = suiteResult();
    let images = imagesReducer([], { type: "add", files: [FILE] });

    images = imagesReducer(images, { type: "start", ref: FILE.ref });
    expect(images[0]?.status).toBe("processing");
    images = imagesReducer(images, { type: "finish", result });
    expect(images[0]).toMatchObject({ status: "done", result });
  });

  it("fails an image whose result failed, with its message", () => {
    const images = imagesReducer([{ ...FILE, status: "processing" }], {
      type: "finish",
      result: {
        input: FILE.ref,
        status: "failed",
        outputs: [],
        warnings: [],
        error: { code: "E_ANIMATED", message: "Animated" },
      },
    });

    expect(images[0]).toMatchObject({ status: "failed", error: "Animated" });
  });

  it("fails only the unfinished images of a batch", () => {
    const images: OpenedImage[] = [
      { ...FILE, status: "processing" },
      { ...FILE, ref: "b", status: "done" },
      { ...FILE, ref: "c", status: "queued" },
    ];
    const failed = imagesReducer(images, {
      type: "fail",
      refs: [FILE.ref, "b"],
      error: "Broke",
    });

    expect(failed.map((image) => image.status)).toEqual([
      "failed",
      "done",
      "queued", // not in the batch
    ]);
  });

  it("queues every image again, dropping its result", () => {
    const images = imagesReducer(
      [{ ...FILE, status: "done", result: suiteResult() }],
      { type: "requeue" }
    );

    expect(images).toEqual([{ ...FILE, status: "queued" }]);
    expect(queuedRefs(images)).toEqual([FILE.ref]);
  });

  it("rewrites outputs' files and sizes, and swaps the rights warnings for the rewrite's", () => {
    const result = {
      ...suiteResult(FILE.ref),
      warnings: [
        { code: "W_NO_RIGHTS" as const, message: "No rights" },
        { code: "W_ICC_KEPT" as const, message: "Profile kept" },
      ],
    };
    const images = imagesReducer([{ ...FILE, status: "done", result }], {
      type: "rights",
      rewritten: [
        {
          ref: FILE.ref,
          candidates: result.outputs.map((_output, index) => ({
            ref: `session/rights/1/${index}/out`,
            bytes: 1_000,
            saving: 0.99,
            larger: false,
            rights: {},
            rightsAdded: [],
            warnings: [],
          })),
        },
      ],
    });
    const rewritten = images[0]?.result;

    expect(rewritten?.outputs.map((output) => output.path)).toEqual([
      "session/rights/1/0/out",
      "session/rights/1/1/out",
      "session/rights/1/2/out",
    ]);
    expect(rewritten?.outputs[0]).toMatchObject({ bytes: 1_000, saving: 0.99 });
    expect(rewritten?.warnings.map((warning) => warning.code)).toEqual([
      "W_ICC_KEPT",
    ]);
  });
});
