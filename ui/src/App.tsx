import { useEffect, useState } from "react";
import { formatTotals } from "../../src/cli/format.js";
import type { ServerListedFile } from "../../src/server/api.js";
import { listFiles, messageOf, uploadFiles } from "./api.js";
import type { RunOptions } from "./api.js";
import type { ComparisonFile } from "./comparison.js";
import ComparisonViewer from "./components/ComparisonViewer.js";
import CopyButton from "./components/CopyButton.js";
import FileList from "./components/FileList.js";
import OptionsPanel from "./components/OptionsPanel.js";
import ResultsTable from "./components/ResultsTable.js";
import { cliCommand, markupText } from "./copyText.js";
import downloadJson from "./downloadJson.js";
import { toRunResult } from "./runState.js";
import type { RunState } from "./runState.js";
import useRun from "./useRun.js";

const DEFAULT_OPTIONS: RunOptions = { to: "webp", target: "high" }; // the cli's

/**
 * Describes where a run is: what to do first, its progress, its totals, or why it ended.
 *
 * @param run - The run.
 */
function statusOf(run: RunState) {
  const done = run.files.filter((file) => file.result !== undefined).length;
  const progress = `${done} of ${run.files.length} files done`;

  switch (run.status) {
    case "idle":
      return "Pick images and press Run. Outputs go to a temp folder, and nothing in the folder changes until you Write one.";
    case "running":
      return `Optimising: ${progress}`;
    case "done":
      return run.totals === undefined ? progress : formatTotals(run.totals);
    case "stopped":
      return `Stopped: ${progress}`;
    case "failed":
      return `The run failed: ${run.error ?? "unknown error"}`;
  }
}

/**
 * Renders the comparison UI: the images to pick from, the run's options, its results, and a
 * file's comparison once opened.
 */
function App() {
  const [root, setRoot] = useState<string>();
  const [files, setFiles] = useState<ServerListedFile[]>([]);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [problem, setProblem] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [listings, setListings] = useState(0);
  const [comparing, setComparing] = useState<ComparisonFile>();
  const { run, start, stop } = useRun();

  useEffect(() => {
    let current = true;

    listFiles().then(
      (listing) => {
        if (current) {
          setRoot(listing.root);
          setFiles(listing.files);
          setProblem(undefined);
        }
      },
      (error: unknown) => {
        if (current) {
          setProblem(`Couldn't list the images: ${messageOf(error)}`);
        }
      }
    );
    return () => {
      current = false;
    };
  }, [listings]);

  const upload = async (added: File[]) => {
    if (added.length === 0) {
      return;
    }
    setUploading(true);
    try {
      const stored = await uploadFiles(added);

      setFiles((current) => [...current, ...stored]);
      setProblem(undefined);
    } catch (error) {
      setProblem(`Couldn't upload: ${messageOf(error)}`);
    } finally {
      setUploading(false);
    }
  };

  const running = run.status === "running";
  const picked = files
    .map((file) => file.ref)
    .filter((ref) => !excluded.has(ref));
  const command =
    root === undefined || picked.length === 0
      ? undefined
      : cliCommand(picked, options, root);
  const report = toRunResult(run);
  const finished = run.files.flatMap((file) => file.result ?? []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>wio</h1>
        <span className="root" title={root}>
          {root}
        </span>
      </header>
      <FileList
        files={files}
        excluded={excluded}
        uploading={uploading}
        onExcludedChange={setExcluded}
        onUpload={(added) => void upload(added)}
        onRefresh={() => {
          setListings((count) => count + 1);
        }}
      />
      <main className="workspace">
        {problem !== undefined && (
          <p className="problem" role="alert">
            {problem}
          </p>
        )}
        <section className="card run-setup" aria-label="Run">
          <OptionsPanel
            options={options}
            disabled={running}
            onChange={setOptions}
          />
          <div className="run-button">
            {running ? (
              <button type="button" onClick={stop}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={picked.length === 0}
                onClick={() => void start(picked, options)}
              >
                Run {picked.length} {picked.length === 1 ? "image" : "images"}
              </button>
            )}
          </div>
          <div className="command">
            <code title={command}>
              {command ?? "Pick an image to see the command"}
            </code>
            <CopyButton label="Copy CLI command" text={command} />
          </div>
        </section>
        <section className="card run-results" aria-label="Results">
          <div className="run-status">
            <p role="status">{statusOf(run)}</p>
            {running && (
              <progress
                value={finished.length}
                max={run.files.length}
                aria-label="Files done"
              />
            )}
            <div className="run-actions">
              <button
                type="button"
                disabled={report === undefined}
                onClick={() => {
                  downloadJson("wio-report.json", report);
                }}
              >
                Export report
              </button>
              {run.start?.options.to === "suite" && (
                <CopyButton label="Copy markup" text={markupText(finished)} />
              )}
            </div>
          </div>
          {run.files.length > 0 && (
            <ResultsTable files={run.files} onCompare={setComparing} />
          )}
        </section>
      </main>
      {comparing !== undefined && (
        <ComparisonViewer
          file={comparing}
          onClose={() => {
            setComparing(undefined);
          }}
        />
      )}
    </div>
  );
}

export default App;
