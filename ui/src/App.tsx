import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { formatTotals } from "../../src/cli/format.js";
import type { PipelineWarning } from "../../src/pipeline/types.js";
import { canCompare, cappedWidth } from "./comparison.js";
import ComparisonViewer from "./components/ComparisonViewer.js";
import type { ViewerTools } from "./components/ComparisonViewer.js";
import Landing from "./components/Landing.js";
import OptionsBar from "./components/OptionsBar.js";
import SlideOver from "./components/SlideOver.js";
import type { OpenedImage } from "./images.js";
import { keptRefs, paneKey, paneKeysOf, panesOf, runTarget } from "./panes.js";
import useAppOptions from "./useAppOptions.js";
import useImages from "./useImages.js";
import useSaves from "./useSaves.js";
import useTargetSearches from "./useTargetSearches.js";

/**
 * Files the bridge opened.
 */
type Opened = Awaited<ReturnType<Window["wio"]["openDropped"]>>;

/**
 * Returns what to tell the person about files that weren't opened.
 *
 * @param opened - The files, as the bridge answered.
 */
function refusalsOf(opened: Opened) {
  const messages = opened.files.flatMap((file) =>
    "error" in file ? [`${file.name}: ${file.error}`] : []
  );

  return messages.length === 0 ? undefined : messages.join(" ");
}

/**
 * Returns whether a drag carries files, rather than text or a link.
 *
 * @param event - The drag event.
 */
function carriesFiles(event: DragEvent) {
  return event.dataTransfer.types.includes("Files");
}

/**
 * Renders an image's warnings as notices, with an Add rights info button on `W_NO_RIGHTS`.
 *
 * @param props - The warnings, and what the button does.
 */
function Notices({
  warnings,
  onAddRights,
}: {
  warnings: PipelineWarning[];
  onAddRights: () => void;
}) {
  if (warnings.length === 0) {
    return null;
  }
  return (
    <ul className="notices">
      {warnings.map((warning) => (
        <li key={`${warning.code} ${warning.message}`}>
          <code className="code">{warning.code}</code> {warning.message}
          {warning.code === "W_NO_RIGHTS" && (
            <button type="button" onClick={onAddRights}>
              Add rights info
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Renders the main view for an image: its grid once done, its progress while it waits, or its
 * error.
 *
 * @param props - The image, the viewer's tools, and what Add rights info does.
 */
function ImageView({
  image,
  tools,
  onAddRights,
}: {
  image: OpenedImage;
  tools: ViewerTools;
  onAddRights: () => void;
}) {
  const { result } = image;

  if (result !== undefined && canCompare(result) && image.status === "done") {
    return (
      <ComparisonViewer
        key={image.ref}
        file={result}
        name={image.name}
        maxWidth={cappedWidth(result)}
        replaced={image.replaced}
        tools={tools}
      >
        <Notices warnings={result.warnings} onAddRights={onAddRights} />
      </ComparisonViewer>
    );
  }
  return (
    <section className="image-message" aria-label={image.name}>
      <h2>{image.name}</h2>
      {image.status === "failed" ? (
        <p className="problem" role="alert">
          {image.error}
        </p>
      ) : image.status === "done" ? (
        <p>Nothing to compare: the original was kept.</p>
      ) : (
        <p role="status">
          <span className="spinner" aria-hidden="true" />
          {image.status === "processing" ? "Processing" : "Waiting"}
        </p>
      )}
      {result !== undefined && (
        <Notices warnings={result.warnings} onAddRights={onAddRights} />
      )}
    </section>
  );
}

/**
 * Renders the desktop app: a drop zone to start with, then each opened image processed at the
 * `web` target and shown as a comparison grid, with a slide-over listing them when there are
 * several.
 */
function App() {
  const { options, setOptions, settings, loaded } = useAppOptions();
  const { images, running, totals, problem, add, markReplaced } =
    useImages(settings);
  const [refused, setRefused] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [listShown, setListShown] = useState(true);
  const [rightsOpen, setRightsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const searches = useTargetSearches(settings);
  const saves = useSaves(markReplaced);

  const open = (opened: Opened) => {
    const files = opened.files.flatMap((file) =>
      "ref" in file
        ? [{ ref: file.ref, name: file.name, bytes: file.bytes }]
        : []
    );

    for (const { ref } of files) {
      if (
        images.some((image) => image.ref === ref && image.replaced === true)
      ) {
        for (const pane of paneKeysOf(ref)) {
          searches.reset(pane); // they were made from the old original, which runs again
          saves.forget(pane);
        }
      }
    }
    add(files);
    setRefused(refusalsOf(opened));
  };
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  });
  useEffect(
    () =>
      window.wio.onFilesOpened((opened) => {
        openRef.current(opened);
      }),
    []
  );

  const browse = () => {
    void window.wio.openFiles().then((opened) => {
      if (opened.outcome === "opened") {
        open(opened);
      }
    });
  };

  const saveAll = () => {
    const suites = images.flatMap(({ ref, status, result, replaced }) => {
      if (
        status !== "done" ||
        result === undefined ||
        !canCompare(result) ||
        replaced === true
      ) {
        return [];
      }

      const panes = panesOf(result, (role) =>
        searches.searchOf(paneKey(ref, role))
      );
      const candidates = keptRefs(panes);

      return candidates.length === 0 ? [] : [{ original: ref, candidates }];
    });

    if (suites.length === 0) {
      saves.setNote({ text: "Nothing to save yet", failed: false });
      return;
    }
    void saves.saveSuites(suites, images.length - suites.length);
  };
  const saveAllRef = useRef(saveAll);

  useEffect(() => {
    saveAllRef.current = saveAll;
  });
  useEffect(
    () =>
      window.wio.onMenuCommand((command) => {
        if (command === "save-all") {
          saveAllRef.current();
        }
      }),
    []
  );

  const tools: ViewerTools = {
    target: settings === undefined ? undefined : runTarget(settings),
    searches,
    saves,
  };
  const current = images.find((image) => image.ref === selected) ?? images[0];
  const summary =
    totals === undefined || running ? undefined : formatTotals(totals);

  return (
    <div
      className="app"
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        if (carriesFiles(event)) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={(event) => {
        setDragging(false);
        if (carriesFiles(event)) {
          event.preventDefault();
          void window.wio.openDropped([...event.dataTransfer.files]).then(open);
        }
      }}
    >
      <header className="app-header">
        <h1>wio</h1>
        {images.length > 1 && (
          <button
            type="button"
            aria-pressed={listShown}
            onClick={() => {
              setListShown((shown) => !shown);
            }}
          >
            Images
          </button>
        )}
        {images.length > 0 && (
          <button type="button" onClick={browse}>
            Open...
          </button>
        )}
        <OptionsBar
          key={String(loaded)}
          options={options}
          onChange={setOptions}
          rightsOpen={rightsOpen}
          onRightsOpenChange={setRightsOpen}
        />
      </header>
      {images.length > 1 && listShown && (
        <SlideOver
          images={images}
          selected={current?.ref}
          summary={summary}
          onSelect={setSelected}
          onOpenMore={browse}
          onSaveAll={saveAll}
        />
      )}
      <main className="workspace">
        {problem !== undefined && (
          <p className="problem" role="alert">
            {problem}
          </p>
        )}
        {saves.note !== undefined && (
          <p
            className={saves.note.failed ? "problem" : "save-note"}
            role={saves.note.failed ? "alert" : "status"}
          >
            {saves.note.text}
          </p>
        )}
        {current === undefined ? (
          <Landing onBrowse={browse} problem={refused} />
        ) : (
          <>
            {refused !== undefined && (
              <p className="problem" role="alert">
                {refused}
              </p>
            )}
            <ImageView
              image={current}
              tools={tools}
              onAddRights={() => {
                setRightsOpen(true);
              }}
            />
          </>
        )}
      </main>
    </div>
  );
}

export default App;
