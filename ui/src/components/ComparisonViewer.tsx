import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { formatBytes } from "../../../src/cli/format.js";
import type { PipelineOutput } from "../../../src/pipeline/types.js";
import { outputTitle } from "../comparison.js";
import type { ComparisonFile } from "../comparison.js";
import { keptRefs, paneKey, panesOf } from "../panes.js";
import type { ViewPane } from "../panes.js";
import { imageUrl } from "../refs.js";
import useDevicePixelRatio from "../useDevicePixelRatio.js";
import useDiffOverlays from "../useDiffOverlays.js";
import type { DiffOverlay } from "../useDiffOverlays.js";
import type useSaves from "../useSaves.js";
import type useTargetSearches from "../useTargetSearches.js";
import { FIT_VIEW, ZOOM_PRESETS, zoomTo } from "../viewport.js";
import type { Viewport } from "../viewport.js";
import ImageViewport from "./ImageViewport.js";
import type { ImageViewportLayer } from "./ImageViewport.js";
import OutputHeader from "./OutputHeader.js";
import SaveOutput from "./SaveOutput.js";
import TargetSlider from "./TargetSlider.js";
import WipeDivider from "./WipeDivider.js";

/**
 * What the viewer searches and saves with: the run's target, which the sliders start at, or
 * `undefined` while the options are changing, when there are no sliders, and the app's slider and
 * save state, which outlives the viewer.
 */
type ViewerTools = {
  target: number | undefined;
  searches: ReturnType<typeof useTargetSearches>;
  saves: ReturnType<typeof useSaves>;
};

/**
 * {@link ComparisonViewer}'s props: the file to compare, its name, the width its outputs were
 * capped at if any, whether a save has replaced the original, what shows above the grid, such as
 * the file's notices, and the tools for searching and saving (without them the viewer only
 * compares).
 */
type ComparisonViewerProps = {
  file: ComparisonFile;
  name: string;
  maxWidth?: number;
  replaced?: boolean;
  children?: ReactNode;
  tools?: ViewerTools;
};

/**
 * A pane that has an output to show.
 */
type ShownPane = ViewPane & { output: PipelineOutput };

/**
 * Returns whether a pane has an output to show.
 *
 * @param pane - The pane.
 */
function isShown(pane: ViewPane): pane is ShownPane {
  return pane.output !== undefined;
}

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
 * Returns the viewer's hint: how to use the grid or the wipe.
 *
 * @param wiping - Whether an output is wiped against the original.
 */
function hintOf(wiping: boolean) {
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
 * Renders a file's comparison as the main view: the original beside each output, zoomed and
 * panned together, or one output wiped against the original. Each output can show a diff
 * overlay, a target slider and a Save button, and the grid saves the suite. Escape leaves a
 * wipe.
 *
 * @param props - The file, its name, what shows above the grid, and the tools.
 */
function ComparisonViewer({
  file,
  name,
  maxWidth,
  replaced = false,
  children,
  tools,
}: ComparisonViewerProps) {
  const [view, setView] = useState<Viewport>(FIT_VIEW);
  const [wiping, setWiping] = useState<PipelineOutput["role"]>();
  const [divider, setDivider] = useState(0.5);
  const pixelRatio = useDevicePixelRatio();
  const panes = panesOf(file, (role) =>
    tools?.searches.searchOf(paneKey(file.input, role))
  );
  const candidates = new Map(
    panes.filter(isShown).map(({ role, output }) => [role, output.path])
  );
  const { overlayOf, show, setOpacity } = useDiffOverlays(
    file.input,
    candidates,
    maxWidth
  );
  const image = useMemo(
    () => ({ width: file.width, height: file.height }),
    [file.width, file.height]
  );
  const wiped = panes.filter(isShown).find(({ role }) => role === wiping);
  const original = { src: imageUrl(file.input), alt: "Original" };
  const shared = { image, view, pixelRatio, onViewChange: setView };
  const suite = keptRefs(panes);

  useEffect(() => {
    if (wiping === undefined) {
      return;
    }

    const leave = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWiping(undefined);
      }
    };

    window.addEventListener("keydown", leave);
    return () => {
      window.removeEventListener("keydown", leave);
    };
  }, [wiping]);

  const paneTools = (pane: ViewPane) => {
    if (tools === undefined || replaced) {
      return null;
    }

    const key = paneKey(file.input, pane.role);
    const { searches, saves } = tools;
    const { format, output } = pane;

    return (
      <>
        {format !== undefined && tools.target !== undefined && (
          <TargetSlider
            title={pane.title}
            target={pane.search?.target ?? tools.target}
            pending={pane.search?.pending === true}
            error={pane.search?.error}
            onChange={(target) => {
              searches.setTarget(key, file.input, format, target);
            }}
            onReset={
              pane.search === undefined
                ? undefined
                : () => {
                    searches.reset(key);
                  }
            }
          />
        )}
        {output !== undefined && output.saving >= 0 && (
          <SaveOutput
            state={saves.saveOf(key)}
            onSave={() => {
              void saves.saveOutput(key, file.input, output.path);
            }}
          />
        )}
      </>
    );
  };

  const headerOf = (pane: ShownPane, onWipe?: () => void) => (
    <OutputHeader
      output={pane.output}
      overlay={overlayOf(pane.role)}
      onShowDiff={(shown) => {
        show(pane.role, shown);
      }}
      onDiffOpacity={(opacity) => {
        setOpacity(pane.role, opacity);
      }}
      onWipe={onWipe}
    >
      {pane.output.saving < 0 && (
        <span className="muted">Larger than the original</span>
      )}
      {!pane.reached && <span className="muted">Target not reached</span>}
      {pane.note !== undefined && <span className="muted">{pane.note}</span>}
      {paneTools(pane)}
    </OutputHeader>
  );

  return (
    <div className="viewer">
      <header className="viewer-bar">
        <h2 className="viewer-title">{name}</h2>
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
          {hintOf(wiped !== undefined)}
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
          {tools !== undefined && !replaced && (
            <button
              type="button"
              disabled={suite.length === 0 || tools.saves.suiteSaving}
              onClick={() => {
                void tools.saves.saveSuites(
                  [{ original: file.input, candidates: suite }],
                  0
                );
              }}
            >
              Save suite
            </button>
          )}
        </div>
      </header>
      {replaced && (
        <p className="notices" role="status">
          The original was replaced, so these outputs are of the old one. Open
          the image again to compare the new one.
        </p>
      )}
      {children}
      {wiped === undefined ? (
        <div className="viewer-grid">
          <section className="pane" aria-label="Original">
            <OriginalHeader file={file} />
            <ImageViewport label="Original" layers={[original]} {...shared} />
          </section>
          {panes.map((pane) => {
            if (!isShown(pane)) {
              return (
                <section
                  key={pane.role}
                  className="pane"
                  aria-label={pane.title}
                >
                  <header className="pane-header">
                    <h3>{pane.title}</h3>
                    <div className="pane-tools">
                      {pane.note !== undefined && (
                        <span className="muted">{pane.note}</span>
                      )}
                      {paneTools(pane)}
                    </div>
                  </header>
                  <p className="pane-empty muted">
                    {pane.format === undefined
                      ? "No JPEG or PNG was smaller than the original."
                      : `Move the slider to find the smallest ${pane.title} that reaches a target.`}
                  </p>
                </section>
              );
            }

            const select = () => {
              setWiping(pane.role);
            };

            return (
              <section key={pane.role} className="pane" aria-label={pane.title}>
                {headerOf(pane, select)}
                <ImageViewport
                  label={pane.title}
                  layers={outputLayers(pane.output, overlayOf(pane.role))}
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
          aria-label={`Original against the ${wiped.title}`}
        >
          <div className="wipe-headers">
            <OriginalHeader file={file} />
            {headerOf(wiped)}
          </div>
          <ImageViewport
            label={`Original against the ${wiped.title}`}
            layers={[
              ...outputLayers(wiped.output, overlayOf(wiped.role)),
              { ...original, clipRight: 1 - divider },
            ]}
            {...shared}
          >
            <WipeDivider position={divider} onChange={setDivider} />
          </ImageViewport>
        </section>
      )}
    </div>
  );
}

export default ComparisonViewer;
export type { ComparisonViewerProps, ViewerTools };
