import { useState } from "react";
import type { ServerWriteResponse } from "../../src/server/api.js";
import { messageOf, writeImage } from "./api.js";
import type { WriteReplacing } from "./api.js";

/**
 * Where saving an image into the folder served has got to: under way, answered (written, or
 * blocked by a file it would replace), or failed.
 */
type WriteState =
  | { status: "writing" }
  | { status: "done"; response: ServerWriteResponse }
  | { status: "failed"; error: string };

/**
 * Saves images into the folder served, beside their original, keeping how each went by image.
 *
 * @param original - The original's ref.
 * @returns An image's write, a function that writes one, and whether a write has replaced the
 * original.
 */
function useWrites(original: string) {
  const [writes, setWrites] = useState<ReadonlyMap<string, WriteState>>(
    new Map()
  );

  const set = (candidate: string, state: WriteState) => {
    setWrites((current) => new Map(current).set(candidate, state));
  };

  const write = (candidate: string, replacing?: WriteReplacing) => {
    set(candidate, { status: "writing" });
    writeImage(original, candidate, replacing).then(
      (response) => {
        set(candidate, { status: "done", response });
      },
      (error: unknown) => {
        set(candidate, { status: "failed", error: messageOf(error) });
      }
    );
  };

  const writeOf = (candidate: string) => writes.get(candidate);
  const replacedOriginal = [...writes.values()].some(
    (state) =>
      state.status === "done" &&
      state.response.outcome === "written" &&
      state.response.ref === original
  );

  return { writeOf, write, replacedOriginal };
}

export default useWrites;
export type { WriteState };
