import {
  STATUS_LABELS,
  VERDICT_MEANINGS,
  formatBytes,
  formatPercent,
  formatQuality,
  verdictRating,
} from "../../../src/cli/format.js";
import type { PipelineFileResult } from "../../../src/pipeline/types.js";
import { canCompare } from "../comparison.js";
import type { ComparisonFile } from "../comparison.js";
import { displayName } from "../refs.js";
import type { RunFile } from "../runState.js";

/**
 * {@link ResultsTable}'s props: the run's files, in input order, and what comparing one does.
 */
type ResultsTableProps = {
  files: RunFile[];
  onCompare: (file: ComparisonFile) => void;
};

/**
 * Returns a finished file's error and warnings, the error first.
 *
 * @param result - The file's result.
 */
function notesOf(result: PipelineFileResult | undefined) {
  if (result === undefined) {
    return [];
  }
  return result.error === undefined
    ? result.warnings
    : [result.error, ...result.warnings];
}

/**
 * Renders a file's error and warning codes, each titled with its message.
 *
 * @param props - The file's result.
 */
function Notes({ result }: { result: PipelineFileResult | undefined }) {
  return (
    <td className="notes">
      {notesOf(result).map((note, index) => (
        <code
          key={index}
          className="code"
          data-failed={note.code.startsWith("E_") || undefined}
          title={note.message}
        >
          {note.code}
        </code>
      ))}
    </td>
  );
}

/**
 * Renders the cell naming a file, with its size once read, and a Compare button once it has
 * outputs.
 *
 * @param props - The file, how many rows it spans, and what comparing it does.
 */
function FileCell({
  file: { ref, result },
  rows,
  onCompare,
}: Pick<ResultsTableProps, "onCompare"> & { file: RunFile; rows: number }) {
  return (
    <th scope="rowgroup" rowSpan={rows}>
      <span className="file-name">{displayName(ref)}</span>
      {result?.bytes !== undefined && (
        <span className="file-size">{formatBytes(result.bytes)}</span>
      )}
      {result !== undefined && canCompare(result) && (
        <button
          type="button"
          className="quiet compare"
          aria-label={`Compare ${displayName(ref)}`}
          onClick={() => {
            onCompare(result);
          }}
        >
          Compare
        </button>
      )}
    </th>
  );
}

/**
 * Renders one file's rows: one per output, or one with its progress or status.
 *
 * @param props - The file, and what comparing it does.
 */
function FileRows({
  file,
  onCompare,
}: Pick<ResultsTableProps, "onCompare"> & { file: RunFile }) {
  const { result } = file;

  if (result === undefined || result.outputs.length === 0) {
    const status =
      result === undefined
        ? file.running
          ? "running"
          : "queued"
        : STATUS_LABELS[result.status];

    return (
      <tbody>
        <tr>
          <FileCell file={file} rows={1} onCompare={onCompare} />
          <td colSpan={7} className="status" data-status={status}>
            {status === "running" && (
              <span className="spinner" aria-hidden="true" />
            )}
            {status}
          </td>
          <Notes result={result} />
        </tr>
      </tbody>
    );
  }
  return (
    <tbody>
      {result.outputs.map((output, index) => (
        <tr key={output.path}>
          {index === 0 && (
            <FileCell
              file={file}
              rows={result.outputs.length}
              onCompare={onCompare}
            />
          )}
          <td>{output.role}</td>
          <td>{output.format}</td>
          <td>{formatQuality(output)}</td>
          <td className="number">{formatBytes(output.bytes)}</td>
          <td className="number">{formatPercent(output.saving)}</td>
          <td className="number">{output.score.toFixed(1)}</td>
          <td>
            <span
              className="verdict"
              data-rating={verdictRating(output.verdict)}
              title={VERDICT_MEANINGS[output.verdict]}
            >
              {output.verdict}
            </span>
          </td>
          {index === 0 && <Notes result={result} />}
        </tr>
      ))}
    </tbody>
  );
}

/**
 * Renders a run's results as the CLI's table does, one row per output, with each file's
 * progress until it is done, then every error and warning in full. A finished file's Compare
 * button opens its comparison.
 *
 * @param props - The run's files, and what comparing one does.
 */
function ResultsTable({ files, onCompare }: ResultsTableProps) {
  const messages = files.flatMap((file) =>
    notesOf(file.result).map((note) => ({ ...note, file: file.ref }))
  );

  return (
    <div className="results">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Output</th>
              <th scope="col">Format</th>
              <th scope="col">Quality</th>
              <th scope="col" className="number">
                Size
              </th>
              <th scope="col" className="number">
                Saving
              </th>
              <th scope="col" className="number">
                Score
              </th>
              <th scope="col">Verdict</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          {files.map((file) => (
            <FileRows key={file.ref} file={file} onCompare={onCompare} />
          ))}
        </table>
      </div>
      {messages.length > 0 && (
        <ul className="messages">
          {messages.map((message, index) => (
            <li key={index}>
              <span className="file-name">{displayName(message.file)}</span>{" "}
              <code
                className="code"
                data-failed={message.code.startsWith("E_") || undefined}
              >
                {message.code}
              </code>{" "}
              {message.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ResultsTable;
export type { ResultsTableProps };
