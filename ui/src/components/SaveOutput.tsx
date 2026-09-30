import type { SaveState } from "../useSaves.js";

/**
 * {@link SaveOutput}'s props: how saving the pane's image went, and what saving does.
 */
type SaveOutputProps = {
  state: SaveState | undefined;
  onSave: () => void;
};

/**
 * Renders an output pane's Save button, which opens the save dialog for the image it shows, then
 * where it went, or why it failed.
 *
 * @param props - The save's state and handler.
 */
function SaveOutput({ state, onSave }: SaveOutputProps) {
  return (
    <>
      <button
        type="button"
        disabled={state?.status === "saving"}
        onClick={onSave}
      >
        Save
      </button>
      {state?.status === "saved" && (
        <span className="save-note" role="status">
          Saved as {state.name}
        </span>
      )}
      {state?.status === "failed" && (
        <span className="pane-error" role="alert">
          {state.error}
        </span>
      )}
    </>
  );
}

export default SaveOutput;
export type { SaveOutputProps };
