import type { WriteReplacing } from "../api.js";
import { displayName } from "../refs.js";
import type { WriteState } from "../useWrites.js";

/**
 * {@link WriteOutput}'s props: how writing the pane's image went, whether it is larger than the
 * original, and what writing does.
 */
type WriteOutputProps = {
  state: WriteState | undefined;
  larger: boolean;
  onWrite: (replacing?: WriteReplacing) => void;
};

/**
 * Renders an output pane's Write button, which saves the image it shows into the folder served,
 * then where it went, or what it would replace with a button to replace it.
 *
 * @param props - The write's state and handler.
 */
function WriteOutput({ state, larger, onWrite }: WriteOutputProps) {
  if (larger) {
    return <span className="muted">Larger than the original</span>;
  }
  if (state?.status === "done") {
    const name = displayName(state.response.ref);

    switch (state.response.outcome) {
      case "written":
        return (
          <span className="write-note" role="status">
            Saved as {name}
          </span>
        );
      case "unchanged":
        return (
          <span className="write-note" role="status">
            The original as it was, so nothing to save
          </span>
        );
      case "input":
        return (
          <span className="write-note">
            This replaces the original
            <button
              type="button"
              onClick={() => {
                onWrite({ inPlace: true });
              }}
            >
              Replace original
            </button>
          </span>
        );
      case "exists":
        return (
          <span className="write-note">
            {name} exists
            <button
              type="button"
              onClick={() => {
                onWrite({ overwrite: true });
              }}
            >
              Replace it
            </button>
          </span>
        );
    }
  }
  return (
    <>
      <button
        type="button"
        disabled={state?.status === "writing"}
        title="Save it in the folder, beside the original"
        onClick={() => {
          onWrite();
        }}
      >
        {state?.status === "writing" ? "Writing" : "Write"}
      </button>
      {state?.status === "failed" && (
        <span className="pane-error" role="alert">
          {state.error}
        </span>
      )}
    </>
  );
}

export default WriteOutput;
export type { WriteOutputProps };
