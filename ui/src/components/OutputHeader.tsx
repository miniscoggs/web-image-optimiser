import type { ReactNode } from "react";
import {
  VERDICT_MEANINGS,
  formatBytes,
  formatPercent,
  formatQuality,
  verdictRating,
} from "../../../src/cli/format.js";
import type { PipelineOutput } from "../../../src/pipeline/types.js";
import { outputTitle } from "../comparison.js";
import type { DiffOverlay } from "../useDiffOverlays.js";

/**
 * {@link OutputHeader}'s props: the output, its diff overlay and their setters (without
 * `onShowDiff`, it has no Diff toggle), what its Wipe button does, when it has one, and the
 * pane's other tools.
 */
type OutputHeaderProps = {
  output: PipelineOutput;
  overlay: DiffOverlay;
  onShowDiff?: (shown: boolean) => void;
  onDiffOpacity: (opacity: number) => void;
  onWipe?: () => void;
  children?: ReactNode;
};

/**
 * Renders an output pane's header: its format, how it was made, its size, saving, score and
 * verdict, the pane's other tools, a diff overlay toggle with its opacity (not for SVG, which
 * the server can't diff), and a Wipe button.
 *
 * @param props - The output, its overlay and the other tools.
 */
function OutputHeader({
  output,
  overlay: { shown, opacity, map },
  onShowDiff,
  onDiffOpacity,
  onWipe,
  children,
}: OutputHeaderProps) {
  const title = outputTitle(output);

  return (
    <header className="pane-header">
      <h3>{title}</h3>
      <p className="pane-facts">
        <span>{formatQuality(output)}</span>
        <span>{formatBytes(output.bytes)}</span>
        <span>{formatPercent(output.saving)} smaller</span>
        <span>score {output.score.toFixed(1)}</span>
        <span
          className="verdict"
          data-rating={verdictRating(output.verdict)}
          title={VERDICT_MEANINGS[output.verdict]}
        >
          {output.verdict}
        </span>
      </p>
      <div className="pane-tools">
        {children}
        {onShowDiff !== undefined && output.format !== "svg" && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={shown}
              onChange={(event) => {
                onShowDiff(event.currentTarget.checked);
              }}
            />
            Diff
          </label>
        )}
        {shown && map?.status === "drawn" && (
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(opacity * 100)}
            aria-label={`${title} diff opacity`}
            onChange={(event) => {
              onDiffOpacity(event.currentTarget.valueAsNumber / 100);
            }}
          />
        )}
        {shown && map?.status === "drawing" && (
          <span className="muted">
            <span className="spinner" aria-hidden="true" />
            Drawing
          </span>
        )}
        {shown && map?.status === "failed" && (
          <span className="pane-error" role="alert">
            {map.error}
          </span>
        )}
        {onWipe !== undefined && (
          <button type="button" onClick={onWipe}>
            Wipe
          </button>
        )}
      </div>
    </header>
  );
}

export default OutputHeader;
export type { OutputHeaderProps };
