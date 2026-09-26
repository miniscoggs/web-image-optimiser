/**
 * {@link QualitySlider}'s props: the pane's title, the qualities offered, the one chosen, whether
 * its re-encode is still to come or failed, and what moving the slider and resetting it do.
 */
type QualitySliderProps = {
  title: string;
  range: readonly [number, number];
  quality: number;
  pending: boolean;
  error: string | undefined;
  onChange: (quality: number) => void;
  onReset: (() => void) | undefined;
};

/**
 * Renders an output pane's quality slider, with its value, a spinner while its re-encode is
 * under way, why it failed, and a Reset button once moved.
 *
 * @param props - The slider's state and handlers.
 */
function QualitySlider({
  title,
  range: [min, max],
  quality,
  pending,
  error,
  onChange,
  onReset,
}: QualitySliderProps) {
  return (
    <span className="quality-slider">
      <input
        type="range"
        min={min}
        max={max}
        value={quality}
        aria-label={`${title} quality`}
        onChange={(event) => {
          onChange(event.currentTarget.valueAsNumber);
        }}
      />
      <span className="quality-value" aria-hidden="true">
        {quality}
      </span>
      {pending && (
        <span className="muted">
          <span className="spinner" aria-hidden="true" />
          Encoding
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

export default QualitySlider;
export type { QualitySliderProps };
