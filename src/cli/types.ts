/**
 * A stream the CLI writes text to.
 */
type CliStream = { write: (text: string) => unknown };

/**
 * Where the CLI writes, what the terminal supports, and what stops a run. Only `src/bin/`
 * builds one from the process, so everything else can run in tests.
 *
 * @example
 * ```ts
 * import type { CliIo } from "../cli/index.js";
 *
 * const io: CliIo = { stdout: process.stdout, stderr: process.stderr, color: false, progress: false };
 * ```
 */
type CliIo = {
  /** Receives results: the table, JSON or events. */
  stdout: CliStream;
  /** Receives errors, logs and progress. */
  stderr: CliStream;
  /** Whether stdout shows colour. */
  color: boolean;
  /** Whether stderr is a terminal, where a progress line can be redrawn. */
  progress: boolean;
  /** Stops the run, eg on Ctrl+C. */
  signal?: AbortSignal;
};

export type { CliIo, CliStream };
