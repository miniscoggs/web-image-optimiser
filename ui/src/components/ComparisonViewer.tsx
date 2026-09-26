import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatBytes } from "../../../src/cli/format.js";
import type { PipelineOutput } from "../../../src/pipeline/types.js";
import {
  comparedOutputs,
  currentOutput,
  outputTitle,
  qualitySliderOf,
} from "../comparison.js";
import type { ComparisonFile } from "../comparison.js";
import { displayName, imageUrl } from "../refs.js";
import useDevicePixelRatio from "../useDevicePixelRatio.js";
import useDiffOverlays from "../useDiffOverlays.js";
import type { DiffOverlay } from "../useDiffOverlays.js";
import useQualityEncodes from "../useQualityEncodes.js";
import useWrites from "../useWrites.js";
import { FIT_VIEW, ZOOM_PRESETS, zoomTo } from "../viewport.js";
import type { Viewport } from "../viewport.js";
import ImageViewport from "./ImageViewport.js";
import type { ImageViewportLayer } from "./ImageViewport.js";
import OutputHeader from "./OutputHeader.js";
import QualitySlider from "./QualitySlider.js";
import WipeDivider from "./WipeDivider.js";
import WriteOutput from "./WriteOutput.js";

/**
 * {@link ComparisonViewer}'s props: the file to compare, and what closing the viewer does.
 */
type ComparisonViewerProps = { file: ComparisonFile; onClose: () => void };

/**
 * An output's pane: the run's output, and what the pane shows now, which is a re-encode once
 * its quality slider has moved.
 */
type OutputPane = { output: PipelineOutput; shown: PipelineOutput };

const NO_OVERLAY: DiffOverlay = { shown: false, opacity: 1 };

/**
 * Returns what an output's pane draws: the output, then its diff map while that is shown.
 *
 * @param output - The output.
 * @param overlay - Its diff overlay.
 */
function outputLayers(output: PipelineOutput, overlay: DiffOverlay) {
  const title = outputTitle(output);
  const layers: ImageViewportLayer[] = [
    { src: imageUrl(output.path), alt: title },
  ];

  if (overlay.shown && overlay.map?.status === "drawn") {
    layers.push({
      src: imageUrl(overlay.map.ref),
      alt: `Where the ${title} differs from the original`,
      opacity: overlay.opacity,
    });
  }
  return layers;
}

/**
 * Returns the viewer's hint: how to use the grid or the wipe, or, once a write has replaced the
 * original, that the comparison is out of date, which is why its tools and diffs go.
 *
 * @param wiping - Whether an output is wiped against the original.
 * @param replaced - Whether a write has replaced the original.
 */
function hintOf(wiping: boolean, replaced: boolean) {
  if (replaced) {
    return "The original has been replaced, so this comparison is out of date. Run it again to compare the new file.";
  }
  return wiping
    ? "Drag the divider to wipe between the original, on the left, and the output."
    : "Drag to pan, scroll to zoom, and click an output to wipe it against the original.";
}

/**
 * Renders the original's pane header: its size in pixels and bytes.
 *
 * @param props - The file.
 */
function OriginalHeader({ file }: { file: ComparisonFile }) {
  return (
    <header className="pane-header">
      <h3>Original</h3>
      <p className="pane-facts">
        <span>
          {file.width} x {file.height}
        </span>
        {file.bytes !== undefined && <span>{formatBytes(file.bytes)}</span>}
      </p>
    </header>
  );
}

/**
 * Renders a file's comparison in a modal dialog: the original beside each output, zoomed and
 * panned together, or one output wiped against the original. Each output can show a diff
 * overlay, re-encode at another quality when lossy, and be written into the folder served.
 * Escape leaves a wipe, then closes the dialog.
 *
 * @param props - The file, and what closing does.
 */
function ComparisonViewer({ file, onClose }: ComparisonViewerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [view, setView] = useState<Viewport>(FIT_VIEW);
  const [wiping, setWiping] = useState<string>();
  const [divider, setDivider] = useState(0.5);
  const pixelRatio = useDevicePixelRatio();
  const encodes = useQualityEncodes(file.input);
  const writes = useWrites(file.input);
  const panes = comparedOutputs(file).map((output): OutputPane => ({
    output,
    shown: currentOutput(output, encodes.encodeOf(output.path)?.encoded),
  })); // each pane is keyed by its run output's path
  const candidates = new Map(
    panes.map(({ output, shown }) => [output.path, shown.path])
  );
  const { overlayOf, show, setOpacity } = useDiffOverlays(
    file.input,
    candidates
  );
  const image = useMemo(
    () => ({ width: file.width, height: file.height }),
    [file.width, file.height]
  );
  const wiped = panes.find(({ output }) => output.path === wiping);
  const original = { src: imageUrl(file.input), alt: "Original" };
  const shared = { image, view, pixelRatio, onViewChange: setView };

  useEffect(() => {
    if (dialog.current?.open === false) {
      dialog.current.showModal(); // once, though strict mode runs this twice
    }
  }, []);

  const toolsOf = ({ output, shown }: OutputPane) => {
    const slider = qualitySliderOf(output);
    const encode = encodes.encodeOf(output.path);

    return (
      <>
        {slider !== undefined && (
          <QualitySlider
            title={outputTitle(output)}
            range={slider.range}
            quality={encode?.quality ?? slider.start}
            pending={encode?.pending ?? false}
            error={encode?.error}
            onChange={(quality) => {
              encodes.setQuality(output.path, slider.format, quality);
            }}
            onReset={
              encode === undefined
                ? undefined
                : () => {
                    encodes.reset(output.path);
                  }
            }
          />
        )}
        <WriteOutput
          state={writes.writeOf(shown.path)}
          larger={shown.saving < 0}
          onWrite={(replacing) => {
            writes.write(shown.path, replacing);
          }}
        />
      </>
    );
  };

  const overlayFor = (pane: OutputPane) =>
    writes.replacedOriginal ? NO_OVERLAY : overlayOf(pane.output.path); // a diff against the new file would mislead

  const headerOf = (pane: OutputPane, onWipe?: () => void) => (
    <OutputHeader
      output={pane.shown}
      overlay={overlayFor(pane)}
      onShowDiff={
        writes.replacedOriginal
          ? undefined
          : (shown) => {
              show(pane.output.path, shown);
            }
      }
      onDiffOpacity={(opacity) => {
        setOpacity(pane.output.path, opacity);
      }}
      onWipe={onWipe}
    >
      {!writes.replacedOriginal && toolsOf(pane)}
    </OutputHeader>
  );

  return (
    <dialog
      ref={dialog}
      className="viewer"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (wiped !== undefined) {
          event.preventDefault();
          setWiping(undefined);
        }
      }}
      onClose={onClose}
    >
      <header className="viewer-bar">
        <h2 id={titleId} className="viewer-title">
          {displayName(file.input)}
        </h2>
        <div className="zoom-presets" role="group" aria-label="Zoom">
          <button
            type="button"
            aria-pressed={view.zoom === "fit"}
            onClick={() => {
              setView(FIT_VIEW);
            }}
          >
            Fit
          </button>
          {ZOOM_PRESETS.map((zoom) => (
            <button
              key={zoom}
              type="button"
              aria-pressed={view.zoom === zoom}
              onClick={() => {
                setView((current) => zoomTo(current, zoom, image));
              }}
            >
              {zoom * 100}%
            </button>
          ))}
        </div>
        {view.zoom !== "fit" && (
          <output className="zoom-level" aria-label="Zoom level">
            {Math.round(view.zoom * 100)}%
          </output>
        )}
        <p className="hint" role="status">
          {hintOf(wiped !== undefined, writes.replacedOriginal)}
        </p>
        <div className="viewer-actions">
          {wiped !== undefined && (
            <button
              type="button"
              onClick={() => {
                setWiping(undefined);
              }}
            >
              Back to grid
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              dialog.current?.close(); // which returns focus to the button that opened it
            }}
          >
            Close
          </button>
        </div>
      </header>
      {wiped === undefined ? (
        <div className="viewer-grid">
          <section className="pane" aria-label="Original">
            <OriginalHeader file={file} />
            <ImageViewport label="Original" layers={[original]} {...shared} />
          </section>
          {panes.map((pane) => {
            const title = outputTitle(pane.output);
            const select = () => {
              setWiping(pane.output.path);
            };

            return (
              <section
                key={pane.output.path}
                className="pane"
                aria-label={title}
              >
                {headerOf(pane, select)}
                <ImageViewport
                  label={title}
                  layers={outputLayers(pane.shown, overlayFor(pane))}
                  onSelect={select}
                  {...shared}
                />
              </section>
            );
          })}
        </div>
      ) : (
        <section
          className="pane wipe"
          aria-label={`Original against the ${outputTitle(wiped.output)}`}
        >
          <div className="wipe-headers">
            <OriginalHeader file={file} />
            {headerOf(wiped)}
          </div>
          <ImageViewport
            label={`Original against the ${outputTitle(wiped.output)}`}
            layers={[
              ...outputLayers(wiped.shown, overlayFor(wiped)),
              { ...original, clipRight: 1 - divider },
            ]}
            {...shared}
          >
            <WipeDivider position={divider} onChange={setDivider} />
          </ImageViewport>
        </section>
      )}
    </dialog>
  );
}

export default ComparisonViewer;
export type { ComparisonViewerProps };
