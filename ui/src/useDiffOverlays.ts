import { useEffect, useRef, useState } from "react";
import { diffImage, messageOf } from "./api.js";

/**
 * A candidate's diff map: being drawn, drawn, or failed.
 */
type DiffOverlayMap =
  | { status: "drawing" }
  | { status: "drawn"; ref: string }
  | { status: "failed"; error: string };

/**
 * How a pane shows where its image differs from the original: whether the overlay is on, how
 * opaque it is, and the map of the image it shows now, once asked for.
 */
type DiffOverlay = { shown: boolean; opacity: number; map?: DiffOverlayMap };

type DiffOverlaySetting = Omit<DiffOverlay, "map">;

const HIDDEN: DiffOverlaySetting = { shown: false, opacity: 1 };

const DRAWING: DiffOverlayMap = { status: "drawing" };

/**
 * Keeps each pane's diff overlay, drawing the map of the image a pane shows whenever its overlay
 * is on and that map hasn't been drawn, and again when shown after drawing failed. A pane keeps
 * its overlay when its image changes, such as at another quality.
 *
 * @param original - The original's ref.
 * @param candidates - The ref of the image each pane shows, by pane.
 * @returns A pane's overlay, a function that shows or hides it, and one that sets its opacity.
 */
function useDiffOverlays(
  original: string,
  candidates: ReadonlyMap<string, string>
) {
  const [settings, setSettings] = useState<
    ReadonlyMap<string, DiffOverlaySetting>
  >(new Map());
  const [maps, setMaps] = useState<ReadonlyMap<string, DiffOverlayMap>>(
    new Map()
  );
  const requested = useRef(new Set<string>());
  const wanted = JSON.stringify(
    [...candidates]
      .filter(([pane]) => settings.get(pane)?.shown === true)
      .map(([, candidate]) => candidate)
  ); // a string, so the effect runs only when it changes

  useEffect(() => {
    const draw = (candidate: string, map: DiffOverlayMap) => {
      setMaps((current) => new Map(current).set(candidate, map));
    };

    for (const candidate of JSON.parse(wanted) as string[]) {
      if (!requested.current.has(candidate)) {
        requested.current.add(candidate);
        diffImage(original, candidate).then(
          (ref) => {
            draw(candidate, { status: "drawn", ref });
          },
          (error: unknown) => {
            draw(candidate, { status: "failed", error: messageOf(error) });
          }
        );
      }
    }
  }, [original, wanted]);

  const change = (
    pane: string,
    update: (setting: DiffOverlaySetting) => DiffOverlaySetting
  ) => {
    setSettings((current) => {
      const setting = update(current.get(pane) ?? HIDDEN);

      return new Map(current).set(pane, setting);
    });
  };

  const overlayOf = (pane: string): DiffOverlay => {
    const setting = settings.get(pane) ?? HIDDEN;
    const candidate = candidates.get(pane);
    const map = candidate === undefined ? undefined : maps.get(candidate);

    return { ...setting, map: map ?? (setting.shown ? DRAWING : undefined) };
  };

  const show = (pane: string, shown: boolean) => {
    const candidate = candidates.get(pane);

    if (
      shown &&
      candidate !== undefined &&
      maps.get(candidate)?.status === "failed"
    ) {
      requested.current.delete(candidate); // so the effect draws it again
      setMaps((current) => {
        const next = new Map(current);

        next.delete(candidate);
        return next;
      });
    }
    change(pane, (setting) => ({ ...setting, shown }));
  };

  const setOpacity = (pane: string, opacity: number) => {
    change(pane, (setting) => ({ ...setting, opacity }));
  };

  return { overlayOf, show, setOpacity };
}

export default useDiffOverlays;
export type { DiffOverlay, DiffOverlayMap };
