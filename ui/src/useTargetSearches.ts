import { useEffect, useRef, useState } from "react";
import type { AppSearchResponse, PixelFormat } from "../../src/app/api.js";
import { messageOf, searchTarget } from "./api.js";
import type { RunSettings } from "./api.js";

/**
 * A pane's target slider: the target chosen, the latest search to arrive with the target it was
 * for, whether one at the target chosen is still to come, and why the last one failed.
 */
type TargetSearch = {
  target: number;
  found?: { target: number; response: AppSearchResponse };
  pending: boolean;
  error?: string;
};

/**
 * A pane's slider as it was made, under the options in force then.
 */
type TargetEntry = TargetSearch & { options: string };

const DEBOUNCE_MS = 150;

/**
 * Returns what a search's result depends on apart from the target, to tell when a slider's
 * results have gone stale.
 *
 * @param settings - The run's settings.
 */
function optionsOf(settings: RunSettings | undefined) {
  return JSON.stringify([
    settings?.maxWidth,
    settings?.stripAll,
    settings?.rights,
  ]);
}

/**
 * Keeps each output pane's target slider, searching for the smallest output that reaches the
 * target once the slider has rested for 150 ms. The app caches each search, so going back to a
 * target is quick. A change to the width or the metadata options makes every result stale, so
 * the sliders go back to the run's outputs.
 *
 * @param settings - The run's settings, or `undefined` while they are being changed, when no
 * search starts.
 * @returns A pane's slider, a function that sets its target, and one that returns it to the
 * run's output.
 */
function useTargetSearches(settings: RunSettings | undefined) {
  const [entries, setEntries] = useState<ReadonlyMap<string, TargetEntry>>(
    new Map()
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const wanted = useRef(new Map<string, number>()); // each pane's latest target, for requests already under way
  const busy = useRef(new Set<string>());
  const mounted = useRef(false);
  const latest = useRef(settings);
  const options = optionsOf(settings);

  useEffect(() => {
    latest.current = settings;
  });

  useEffect(() => {
    const pending = timers.current;

    mounted.current = true;
    return () => {
      mounted.current = false; // so a request that returns after unmounting asks for no more
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const change = (
    pane: string,
    made: string,
    update: (entry: TargetEntry) => TargetEntry
  ) => {
    setEntries((current) => {
      const entry = current.get(pane);

      return entry === undefined || entry.options !== made // reset meanwhile
        ? current
        : new Map(current).set(pane, update(entry));
    });
  };

  const request = (pane: string, original: string, format: PixelFormat) => {
    const target = wanted.current.get(pane);
    const current = latest.current;

    if (
      target === undefined ||
      current === undefined ||
      busy.current.has(pane)
    ) {
      return; // one at a time per pane, so a drag doesn't queue a search per step
    }

    const made = optionsOf(current);

    busy.current.add(pane);
    void searchTarget(original, format, { ...current, target })
      .then(
        (response) => {
          change(pane, made, (entry) => ({
            ...entry,
            found: { target, response },
            pending: entry.target !== target,
            error: undefined,
          }));
        },
        (error: unknown) => {
          change(pane, made, (entry) =>
            entry.target === target
              ? { ...entry, pending: false, error: messageOf(error) }
              : entry
          );
        }
      )
      .finally(() => {
        busy.current.delete(pane);
        if (mounted.current && wanted.current.get(pane) !== target) {
          request(pane, original, format); // the slider moved on meanwhile
        }
      });
  };

  const setTarget = (
    pane: string,
    original: string,
    format: PixelFormat,
    target: number
  ) => {
    wanted.current.set(pane, target);
    setEntries((current) => {
      const entry = current.get(pane);
      const found = entry?.options === options ? entry.found : undefined;

      return new Map(current).set(pane, {
        target,
        found,
        pending: found?.target !== target,
        options,
      });
    });
    clearTimeout(timers.current.get(pane));
    timers.current.set(
      pane,
      setTimeout(() => {
        timers.current.delete(pane);
        request(pane, original, format);
      }, DEBOUNCE_MS)
    );
  };

  const reset = (pane: string) => {
    clearTimeout(timers.current.get(pane));
    timers.current.delete(pane);
    wanted.current.delete(pane);
    setEntries((current) => {
      const next = new Map(current);

      next.delete(pane);
      return next;
    });
  };

  const searchOf = (pane: string): TargetSearch | undefined => {
    const entry = entries.get(pane);

    return entry?.options === options ? entry : undefined;
  };

  return { searchOf, setTarget, reset };
}

export default useTargetSearches;
export type { TargetSearch };
