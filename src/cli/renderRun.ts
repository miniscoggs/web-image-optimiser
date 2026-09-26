import type {
  PipelineFileResult,
  PipelineOutput,
  PipelineRunResult,
} from "../pipeline/index.js";
import { formatBytes, formatPercent, paint, verdictStyle } from "./format.js";
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

const STATUS_LABELS = {
  optimised: "optimised",
  "kept-original": "kept original",
  skipped: "skipped",
  failed: "failed",
} as const satisfies Record<PipelineFileResult["status"], string>;

/**
 * Describes how an output was made: its quality for a lossy encode, otherwise its method.
 *
 * @param output - The output.
 */
function qualityOf(output: PipelineOutput) {
  if (output.quality === undefined) {
    return output.method;
  }
  return output.method === "lossy"
    ? `q${output.quality}`
    : `${output.method} ${output.quality}`;
}

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
    qualityOf(output),
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
  const { totals } = result;
  const counts = [
    [totals.optimised, "optimised"],
    [totals.keptOriginal, "kept original"],
    [totals.skipped, "skipped"],
    [totals.failed, "failed"],
  ] as const;
  const parts = counts
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);
  const files = `${totals.files} ${totals.files === 1 ? "file" : "files"}`;
  const saved =
    totals.inputBytes === 0
      ? ""
      : ` ${formatBytes(totals.inputBytes)} -> ${formatBytes(totals.outputBytes)}, ${formatPercent(totals.saving)} smaller.`;
  const dryRun = result.options.dryRun ? " Dry run: nothing was written." : "";

  return `${files}: ${parts.join(", ")}.${saved}${dryRun}\n`;
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
