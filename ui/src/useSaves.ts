import { useState } from "react";
import type { AppSaveSuites } from "../../src/app/api.js";
import { messageOf } from "./api.js";

/**
 * How saving a pane's image went.
 */
type SaveState =
  | { status: "saving" }
  | { status: "saved"; name: string }
  | { status: "failed"; error: string };

/**
 * What the last Save suite or Save all did, for people.
 */
type SuiteNote = { text: string; failed: boolean };

/**
 * Returns a count with its noun.
 *
 * @param count - The count.
 * @param noun - The noun, in the singular.
 */
function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Keeps how each pane's save went, and what the last suite save did, through the desktop bridge,
 * whose dialogs choose every path.
 *
 * @param onReplaced - Called with an original's ref once a save has replaced it.
 * @returns A pane's save, the last suite note, whether a suite is saving, and functions that save
 * a pane and suites, and forget a pane's save.
 */
function useSaves(onReplaced: (original: string) => void) {
  const [states, setStates] = useState<ReadonlyMap<string, SaveState>>(
    new Map()
  );
  const [note, setNote] = useState<SuiteNote>();
  const [suiteSaving, setSuiteSaving] = useState(false);

  const setState = (pane: string, state: SaveState | undefined) => {
    setStates((current) => {
      const next = new Map(current);

      if (state === undefined) {
        next.delete(pane);
      } else {
        next.set(pane, state);
      }
      return next;
    });
  };

  const saveOutput = async (
    pane: string,
    original: string,
    candidate: string
  ) => {
    setState(pane, { status: "saving" });
    try {
      const saved = await window.wio.saveOutput({ original, candidate });

      if (saved.outcome === "saved") {
        setState(pane, { status: "saved", name: saved.name });
        if (saved.replacedOriginal) {
          onReplaced(original);
        }
      } else {
        setState(
          pane,
          saved.outcome === "failed"
            ? { status: "failed", error: saved.error }
            : undefined // the dialog was dismissed
        );
      }
    } catch (error) {
      setState(pane, { status: "failed", error: messageOf(error) });
    }
  };

  const saveSuites = async (suites: AppSaveSuites, skipped: number) => {
    setSuiteSaving(true);
    setNote(undefined);
    try {
      const saved = await window.wio.saveSuites(suites);

      if (saved.outcome === "saved") {
        const renamed = saved.files
          .filter((file) => file.name !== file.wanted)
          .map((file) => `${file.wanted} was taken, so saved ${file.name}`);
        const left =
          skipped === 0
            ? []
            : [
                `${plural(skipped, "image")} skipped: unfinished, failed or replaced`,
              ];

        setNote({
          text: [
            `Saved ${plural(saved.files.length, "file")} to ${saved.folder}`,
            ...renamed,
            ...left,
          ].join(". "),
          failed: false,
        });
      } else if (saved.outcome === "failed") {
        setNote({ text: saved.error, failed: true });
      }
    } catch (error) {
      setNote({ text: messageOf(error), failed: true });
    } finally {
      setSuiteSaving(false);
    }
  };

  return {
    saveOf: (pane: string) => states.get(pane),
    forget: (pane: string) => {
      setState(pane, undefined);
    },
    note,
    setNote,
    suiteSaving,
    saveOutput,
    saveSuites,
  };
}

export default useSaves;
export type { SaveState, SuiteNote };
