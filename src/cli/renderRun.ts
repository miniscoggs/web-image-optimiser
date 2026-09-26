import type {
  PipelineFileResult,
  PipelineRunResult,
} from "../pipeline/index.js";
import {
  STATUS_LABELS,
  formatBytes,
  formatPercent,
  formatQuality,
  formatTotals,
} from "./format.js";
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
 * Returns a file's error and warning codes, red when it failed and yellow otherwise.
 *
 * @param file - The file's result.
 */
function notesOf(file: PipelineFileResult): TableCell {
  const codes = [file.error?.code, ...file.warnings.map((each) => each.code)];

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
 * Renders a run's result for people: a table of every output, a summary, each error and
 * warning in full, and the markup of each file that has some.
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
    ...file.warnings.map(
      (warning) =>
        `${file.input}: ${paint(warning.code, "yellow", color)} ${warning.message}\n`
    ),
  ]);
  const markup = result.files
    .filter((file) => file.markup !== undefined)
    .map((file) => `<!-- ${file.input} -->\n${file.markup}\n`);
  const sections = [
    table,
    summaryOf(result),
    messages.join(""),
    markup.join("\n"),
  ];

  return sections.filter((section) => section !== "").join("\n"); // each section ends in a newline, so this leaves a blank line between them
}

export default renderRun;
