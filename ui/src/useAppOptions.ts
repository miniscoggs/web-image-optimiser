import { useEffect, useMemo, useState } from "react";
import readAppOptions from "../../src/app/appOptions.js";
import type { AppOptions } from "../../src/app/api.js";
import type { RunSettings } from "./api.js";
import useDebounced from "./useDebounced.js";

const DEFAULT_OPTIONS: AppOptions = { stripAll: false, rights: {} };

const SETTLE_MS = 300;

/**
 * Returns the settings a run takes from the options bar's values, at the `web` target. A width
 * that isn't a whole number of pixels, and a rights field that is empty or not a URL, are left
 * out, as are all the rights fields while Remove all metadata is on.
 *
 * @param options - The options bar's values.
 */
function settingsOf(options: AppOptions): RunSettings {
  const { maxWidth, stripAll, rights } = readAppOptions(options);
  const kept = stripAll ? {} : rights; // the api refuses both at once

  return {
    target: "web",
    ...(maxWidth === undefined ? {} : { maxWidth }),
    ...(stripAll ? { stripAll: true } : {}),
    ...(Object.keys(kept).length === 0 ? {} : { rights: kept }),
  };
}

/**
 * Keeps the options bar's values: loaded from the desktop app's memory of them, and saved once
 * they stop changing.
 *
 * @returns The values, a function that changes them, the settings a run takes, which are
 * `undefined` until the values are loaded and again while they are still being changed, and
 * whether they are loaded.
 */
function useAppOptions() {
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [loaded, setLoaded] = useState(false);
  const settled = useDebounced(options, SETTLE_MS);

  useEffect(() => {
    let current = true;

    void window.wio.loadOptions().then((remembered) => {
      if (current) {
        setOptions(remembered);
        setLoaded(true);
      }
    });
    return () => {
      current = false;
    };
  }, []);

  const ready = loaded && settled === options; // until the loaded values settle, settled still holds the defaults

  useEffect(() => {
    if (ready) {
      void window.wio.saveOptions(settled);
    }
  }, [ready, settled]);

  const settings = useMemo(
    () => (ready ? settingsOf(settled) : undefined),
    [ready, settled]
  );

  return { options, setOptions, settings, loaded };
}

export default useAppOptions;
