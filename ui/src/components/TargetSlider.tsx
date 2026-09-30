import { useId } from "react";
import { PIPELINE_TARGET_PRESETS } from "../../../src/pipeline/resolveSettings.js";

/**
 * {@link TargetSlider}'s props: the pane's title, the target chosen, whether its search is still
 * to come or failed, and what moving the slider and resetting it do.
 */
type TargetSliderProps = {
  title: string;
  target: number;
  pending: boolean;
  error: string | undefined;
  onChange: (target: number) => void;
  onReset: (() => void) | undefined;
};

const MIN = 50;
const MAX = 100;

const PRESET_MARKS = Object.entries(PIPELINE_TARGET_PRESETS)
  .map(([name, value]) => ({ name, value }))
  .toSorted((first, second) => first.value - second.value);

/**
 * Renders an output pane's target-score slider, with the presets marked on it, its value, a
 * spinner while its search is under way, why it failed, and a Reset button once moved.
 *
 * @param props - The slider's state and handlers.
 */
function TargetSlider({
  title,
  target,
  pending,
  error,
  onChange,
  onReset,
}: TargetSliderProps) {
  const listId = useId();

  return (
    <span className="target-slider">
      <span className="target-track">
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={1}
          list={listId}
          value={target}
          aria-label={`${title} target score`}
          onChange={(event) => {
            onChange(event.currentTarget.valueAsNumber);
          }}
        />
        <datalist id={listId}>
          {PRESET_MARKS.map(({ name, value }) => (
            <option key={name} value={value} label={name} />
          ))}
        </datalist>
        <span className="target-marks" aria-hidden="true">
          {PRESET_MARKS.map(({ name, value }) => (
            <span
              key={name}
              style={{ left: `${((value - MIN) / (MAX - MIN)) * 100}%` }}
            >
              {value}
            </span>
          ))}
        </span>
      </span>
      <span className="target-value" aria-hidden="true">
        {target}
      </span>
      {pending && (
        <span className="muted">
          <span className="spinner" aria-hidden="true" />
          Searching
        </span>
      )}
      {error !== undefined && (
        <span className="pane-error" role="alert">
          {error}
        </span>
      )}
      {onReset !== undefined && (
        <button type="button" onClick={onReset}>
          Reset
        </button>
      )}
    </span>
  );
}

export default TargetSlider;
export type { TargetSliderProps };
