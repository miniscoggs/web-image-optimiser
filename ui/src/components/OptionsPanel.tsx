import { VERDICT_MEANINGS } from "../../../src/cli/format.js";
import verdictFor from "../../../src/metrics/verdictFor.js";
import { PIPELINE_TARGET_PRESETS } from "../../../src/pipeline/resolveSettings.js";
import { PIPELINE_MODES } from "../../../src/pipeline/types.js";
import type {
  PipelineMode,
  PipelineTargetPreset,
} from "../../../src/pipeline/types.js";
import type { RunOptions } from "../api.js";

const MODES = {
  same: { label: "Same format", hint: "Re-optimises each image as it is" },
  webp: { label: "WebP", hint: "Converts each image to WebP" },
  avif: { label: "AVIF", hint: "Converts each image to AVIF" },
  suite: {
    label: "Suite",
    hint: "Writes AVIF, WebP and a JPEG or PNG fallback for a <picture>",
  },
} as const satisfies Record<PipelineMode, { label: string; hint: string }>;

const PRESETS = Object.entries(PIPELINE_TARGET_PRESETS) as [
  PipelineTargetPreset,
  number,
][];

const CUSTOM = "custom";

/**
 * {@link OptionsPanel}'s props: the options, whether they can change, and what to do when they
 * do.
 */
type OptionsPanelProps = {
  options: RunOptions;
  disabled: boolean;
  onChange: (options: RunOptions) => void;
};

/**
 * Returns the score a target stands for.
 *
 * @param target - A preset or a score.
 */
function scoreOf(target: RunOptions["target"]) {
  return typeof target === "number" ? target : PIPELINE_TARGET_PRESETS[target];
}

/**
 * Renders a run's options, the CLI's `--to` and `--target`.
 *
 * @param props - The options and the change handler.
 */
function OptionsPanel({ options, disabled, onChange }: OptionsPanelProps) {
  const score = scoreOf(options.target);

  return (
    <fieldset className="options" disabled={disabled}>
      <div className="field">
        <span className="field-label" id="mode-label">
          Output
        </span>
        <div
          className="segmented"
          role="radiogroup"
          aria-labelledby="mode-label"
        >
          {PIPELINE_MODES.map((mode) => (
            <label key={mode}>
              <input
                type="radio"
                name="to"
                value={mode}
                checked={options.to === mode}
                onChange={() => {
                  onChange({ ...options, to: mode });
                }}
              />
              <span>{MODES[mode].label}</span>
            </label>
          ))}
        </div>
        <p className="hint">{MODES[options.to].hint}</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="target">
          Quality target
        </label>
        <div className="target">
          <select
            id="target"
            value={typeof options.target === "number" ? CUSTOM : options.target}
            onChange={(event) => {
              const { value } = event.target;

              onChange({
                ...options,
                target:
                  value === CUSTOM ? score : (value as PipelineTargetPreset),
              });
            }}
          >
            {PRESETS.map(([preset, presetScore]) => (
              <option key={preset} value={preset}>
                {preset} ({presetScore})
              </option>
            ))}
            <option value={CUSTOM}>custom score</option>
          </select>
          {typeof options.target === "number" && (
            <input
              type="number"
              aria-label="Target score"
              min={0}
              max={100}
              step="any"
              defaultValue={options.target}
              onChange={(event) => {
                const typed = event.target.valueAsNumber;

                if (typed >= 0 && typed <= 100) {
                  onChange({ ...options, target: typed });
                }
              }}
            />
          )}
        </div>
        <p className="hint">
          SSIMULACRA 2 score {score}: {VERDICT_MEANINGS[verdictFor(score)]}
        </p>
      </div>
    </fieldset>
  );
}

export default OptionsPanel;
export type { OptionsPanelProps };
