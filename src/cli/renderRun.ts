import type {
  PipelineFileResult,
  PipelineRunResult,
  PipelineWarning,
} from "../pipeline/index.js";
import {
  STATUS_LABELS,
  formatBytes,
  formatPercent,
  formatQuality,
  formatTotals,
} from "./format.js";
import { OPTIMISE_HINTS, withHint } from "./hints.js";
import { paint, verdictStyle } from "./paint.js";
import renderTable from "./renderTable.js";
import type { TableCell, TableColumn } from "./renderTable.js";

const COLUMNS: TableColumn[] = [
  { title: "File" },
  { title: "Output" },
  { title: "Format" },
  { title: "Quality" },
  { title: "Size", align: "right" },
  { title: "Saving", align: "right" },
  { title: "Score", align: "right" },
  { title: "Verdict" },
  { title: "Notes" },
];

/**
 * Returns whether a warning is `W_NO_RIGHTS`, which the table gives once for the run, since a
 * batch without rights would repeat it on every file.
 *
 * @param warning - The warning.
 */
function isNoRights(warning: PipelineWarning) {
  return warning.code === "W_NO_RIGHTS";
}

/**
 * Returns a file's warnings, leaving out `W_NO_RIGHTS`.
 *
 * @param file - The file's result.
 */
function fileWarnings(file: PipelineFileResult) {
  return file.warnings.filter((warning) => !isNoRights(warning));
}

/**
 * Returns a file's error and warning codes, red when it failed and yellow otherwise.
 *
 * @param file - The file's result.
 */
function notesOf(file: PipelineFileResult): TableCell {
  const codes = [
    file.error?.code,
    ...fileWarnings(file).map((each) => each.code),
  ];

  return {
    text: codes.filter((code) => code !== undefined).join(", "),
    style: file.error === undefined ? "yellow" : "red",
  };
}

/**
 * Returns a file's table rows: one per output, or one with its status when it has none.
 *
 * @param file - The file's result.
 */
function rowsOf(file: PipelineFileResult): TableCell[][] {
  const before = file.bytes === undefined ? "" : formatBytes(file.bytes);

  if (file.outputs.length === 0) {
    const style = file.status === "failed" ? "red" : "yellow";

    return [
      [
        file.input,
        { text: STATUS_LABELS[file.status], style },
        "",
        "",
        before,
        "",
        "",
        "",
        notesOf(file),
      ],
    ];
  }
  return file.outputs.map((output, index) => [
    index === 0 ? file.input : "",
    output.role,
    output.format,
    formatQuality(output),
    `${before} -> ${formatBytes(output.bytes)}`,
    formatPercent(output.saving),
    output.score.toFixed(1),
    { text: output.verdict, style: verdictStyle(output.verdict) },
    index === 0 ? notesOf(file) : "",
  ]);
}

/**
 * Summarises a run: how many files ended each way, and the bytes saved.
 *
 * @param result - The run's result.
 */
function summaryOf(result: PipelineRunResult) {
  const dryRun = result.options.dryRun ? " Dry run: nothing was written." : "";

  return `${formatTotals(result.totals)}${dryRun}\n`;
}

/**
 * Says how many files have no rights fields, with the flags that add them, or nothing when
 * every file has some.
 *
 * @param result - The run's result.
 * @param color - Whether to add colour.
 */
function noRightsOf(result: PipelineRunResult, color: boolean) {
  const count = result.files.filter((file) =>
    file.warnings.some(isNoRights)
  ).length;

  if (count === 0) {
    return "";
  }

  const { code, message } = withHint(
    {
      code: "W_NO_RIGHTS",
      message: `${count} ${count === 1 ? "file has" : "files have"} no copyright or licence metadata`,
    },
    OPTIMISE_HINTS
  );

  return `${paint(code, "yellow", color)} ${message}\n`;
}

/**
 * Renders a run's result for people: a table of every output, a summary, and each error and
 * warning in full, apart from `W_NO_RIGHTS`, which is counted once.
 *
 * @param result - The run's result.
 * @param color - Whether to add colour.
 */
function renderRun(result: PipelineRunResult, color: boolean) {
  const table = renderTable(COLUMNS, result.files.flatMap(rowsOf), color);
  const messages = result.files.flatMap((file) => [
    ...(file.error === undefined
      ? []
      : [
          `${file.input}: ${paint(file.error.code, "red", color)} ${file.error.message}\n`,
        ]),
    ...fileWarnings(file).map(
      (warning) =>
        `${file.input}: ${paint(warning.code, "yellow", color)} ${warning.message}\n`
    ),
  ]);
  const sections = [
    table,
    summaryOf(result),
    `${messages.join("")}${noRightsOf(result, color)}`,
  ];

  return sections.filter((section) => section !== "").join("\n"); // each section ends in a newline, so this leaves a blank line between them
}

export default renderRun;
