import { useEffect, useRef, useState } from "react";
import type {
  PixelFormat,
  ServerEncodeResponse,
} from "../../src/server/api.js";
import { encodeImage, messageOf } from "./api.js";

/**
 * A pane's quality slider: the quality chosen, the latest re-encode to arrive, whether one at
 * the quality chosen is still to come, and why the last one failed.
 */
type QualityEncode = {
  quality: number;
  encoded?: ServerEncodeResponse;
  pending: boolean;
  error?: string;
};

const DEBOUNCE_MS = 150;

/**
 * Keeps each output pane's quality slider, re-encoding the original once the slider has rested
 * for 150 ms. The server caches each quality, so going back to one is quick.
 *
 * @param original - The original's ref.
 * @returns A pane's slider, a function that sets its quality, and one that returns it to the
 * run's output.
 */
function useQualityEncodes(original: string) {
  const [encodes, setEncodes] = useState<ReadonlyMap<string, QualityEncode>>(
    new Map()
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const wanted = useRef(new Map<string, number>()); // each pane's latest quality, for requests already under way
  const busy = useRef(new Set<string>());

  useEffect(() => {
    const pending = timers.current;

    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const change = (
    pane: string,
    update: (encode: QualityEncode) => QualityEncode
  ) => {
    setEncodes((current) => {
      const encode = current.get(pane);

      return encode === undefined // reset meanwhile
        ? current
        : new Map(current).set(pane, update(encode));
    });
  };

  const request = (pane: string, format: PixelFormat) => {
    const quality = wanted.current.get(pane);

    if (quality === undefined || busy.current.has(pane)) {
      return; // one at a time per pane, so a drag doesn't queue a re-encode per step
    }
    busy.current.add(pane);
    void encodeImage(original, format, quality)
      .then(
        (encoded) => {
          change(pane, (encode) => ({
            quality: encode.quality,
            encoded,
            pending: encode.quality !== encoded.quality,
          }));
        },
        (error: unknown) => {
          change(pane, (encode) =>
            encode.quality === quality
              ? { ...encode, pending: false, error: messageOf(error) }
              : encode
          );
        }
      )
      .finally(() => {
        busy.current.delete(pane);
        if (wanted.current.get(pane) !== quality) {
          request(pane, format); // the slider moved on meanwhile
        }
      });
  };

  const setQuality = (pane: string, format: PixelFormat, quality: number) => {
    wanted.current.set(pane, quality);
    setEncodes((current) => {
      const encoded = current.get(pane)?.encoded;

      return new Map(current).set(pane, {
        quality,
        encoded,
        pending: encoded?.quality !== quality,
      });
    });
    clearTimeout(timers.current.get(pane));
    timers.current.set(
      pane,
      setTimeout(() => {
        timers.current.delete(pane);
        request(pane, format);
      }, DEBOUNCE_MS)
    );
  };

  const reset = (pane: string) => {
    clearTimeout(timers.current.get(pane));
    timers.current.delete(pane);
    wanted.current.delete(pane);
    setEncodes((current) => {
      const next = new Map(current);

      next.delete(pane);
      return next;
    });
  };

  const encodeOf = (pane: string) => encodes.get(pane);

  return { encodeOf, setQuality, reset };
}

export default useQualityEncodes;
export type { QualityEncode };
