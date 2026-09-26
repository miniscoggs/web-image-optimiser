import type { Command } from "commander";
import { generatePictureMarkup } from "../markup/index.js";
import { optimiseBatch } from "../pipeline/index.js";
import type {
  PipelineEvent,
  PipelineFileResult,
  PipelineMode,
  PipelineTargetPreset,
} from "../pipeline/index.js";
import expandInputs from "./expandInputs.js";
import withHint from "./hints.js";
import type { CliHints } from "./hints.js";
import renderRun from "./renderRun.js";
import type { CliIo, CliStream } from "./types.js";

const HINTS: CliHints = {
  E_OUTPUT_IS_INPUT: "--out-dir <dir> or --in-place",
  W_OUTPUT_EXISTS: "--overwrite",
};

const CLEAR_LINE = "\r\u001b[2K";

/**
 * The optimise command's flags, as commander parses them.
 */
type OptimiseFlags = {
  to: PipelineMode;
  target: PipelineTargetPreset | number;
  outDir?: string;
  inPlace?: boolean;
  overwrite?: boolean;
  recursive?: boolean;
  dryRun?: boolean;
  json?: boolean;
  ndjson?: boolean;
  markup?: boolean;
  concurrency?: number;
};

/**
 * Creates an event handler that redraws one progress line on a terminal, and clears it when
 * the run is done.
 *
 * @param stderr - The terminal.
 */
function createProgress(stderr: CliStream) {
  let total = 0;
  let done = 0;

  return (event: PipelineEvent) => {
    if (event.type === "run-start") {
      total = event.files;
    } else if (event.type === "file-done") {
      done += 1;
    }
    stderr.write(
      event.type === "run-done"
        ? CLEAR_LINE
        : `${CLEAR_LINE}wio: ${done} of ${total} files done`
    );
  };
}

/**
 * Runs the optimise command: expands the inputs, optimises them, and prints the result as a
 * table, one JSON `RunResult`, or one JSON event per line.
 *
 * @param inputs - The input arguments.
 * @param flags - The flags.
 * @param io - Where to write.
 * @param command - The command, which reports usage errors.
 * @returns The exit code: 1 when a file failed, otherwise 0.
 */
async function runOptimise(
  inputs: string[],
  flags: OptimiseFlags,
  io: CliIo,
  command: Command
) {
  if (flags.markup === true && flags.to !== "suite") {
    command.error("error: --markup needs --to suite", { exitCode: 2 });
  }

  const files = await expandInputs(inputs, {
    recursive: flags.recursive ?? false,
    outDir: flags.outDir,
    mode: flags.to,
  });

  if (files.length === 0) {
    const reason =
      inputs.length === 0
        ? "no inputs were given"
        : "no images were found (folders only include their subfolders with --recursive)";

    command.error(`error: E_NO_INPUTS ${reason}`, {
      exitCode: 2,
      code: "E_NO_INPUTS",
    });
  }

  const present = (file: PipelineFileResult): PipelineFileResult => {
    const markup =
      flags.markup === true
        ? generatePictureMarkup(file, { root: flags.outDir })
        : undefined;

    return {
      ...file,
      warnings: file.warnings.map((warning) => withHint(warning, HINTS)),
      ...(file.error === undefined
        ? {}
        : { error: withHint(file.error, HINTS) }),
      ...(markup === undefined ? {} : { markup }),
    };
  };
  const progress =
    io.progress && flags.ndjson !== true // the events are the progress, and would break into the line
      ? createProgress(io.stderr)
      : undefined;
  const result = await optimiseBatch(
    files,
    {
      to: flags.to,
      target: flags.target,
      outDir: flags.outDir,
      inPlace: flags.inPlace,
      overwrite: flags.overwrite,
      dryRun: flags.dryRun,
    },
    {
      signal: io.signal,
      concurrency: flags.concurrency,
      onEvent: (event) => {
        progress?.(event);
        if (flags.ndjson === true) {
          const shown =
            event.type === "file-done"
              ? { ...event, file: present(event.file) }
              : event;

          io.stdout.write(`${JSON.stringify(shown)}\n`);
        }
      },
    }
  );
  const shown = { ...result, files: result.files.map(present) };

  if (flags.json === true) {
    io.stdout.write(`${JSON.stringify(shown)}\n`);
  } else if (flags.ndjson !== true) {
    io.stdout.write(renderRun(shown, io.color));
  }
  return result.totals.failed > 0 ? 1 : 0;
}

export default runOptimise;
export type { OptimiseFlags };
