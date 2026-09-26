import path from "node:path";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
} from "commander";
import { PIPELINE_MODES, PIPELINE_TARGET_PRESETS } from "../pipeline/index.js";
import type { PipelineTargetPreset } from "../pipeline/index.js";
import runTool from "../pipeline/runTool.js";
import runCompare from "./runCompare.js";
import type { CompareFlags } from "./runCompare.js";
import runOptimise from "./runOptimise.js";
import type { OptimiseFlags } from "./runOptimise.js";
import type { CliIo } from "./types.js";

const EXIT_USAGE = 2;

const DOCS_URL =
  "https://github.com/miniscoggs/web-image-optimiser/blob/main/docs/cli.md";

const OPTIMISE_HELP = `
Targets are SSIMULACRA 2 scores: visually-lossless (90), excellent (85), high (80) or
web (70), or any number from 0 to 100. SVGs always use 90.

Examples:
  wio photos                                WebP beside each image in photos/
  wio photos --recursive --out-dir web      the same for every subfolder, mirrored into web/
  wio "src/**/*.png" --to same --in-place   shrink PNGs where they are
  wio hero.jpg --to suite --out-dir web --markup
                                            AVIF, WebP and a fallback, with <picture> markup
  wio photos --dry-run --json               what would be written, as JSON
  wio compare photo.png photo.webp --diff diff.png

Exit codes:
  0    no file failed (skipped and kept-original files are not failures)
  1    at least one file failed
  2    usage error, including E_NO_INPUTS
  130  stopped by Ctrl+C (143 for SIGTERM)

More: ${DOCS_URL}`;

const COMPARE_HELP = `
Exit codes: 0 when compared, 1 when the comparison failed, 2 for a usage error.`;

/**
 * Parses `--target`: a preset name, or a score from 0 to 100.
 *
 * @param value - The flag's value.
 * @throws InvalidArgumentError otherwise.
 */
function parseTarget(value: string): PipelineTargetPreset | number {
  if (Object.hasOwn(PIPELINE_TARGET_PRESETS, value)) {
    return value as PipelineTargetPreset;
  }

  const score = Number(value);

  if (!/^\d+(\.\d+)?$/.test(value) || score > 100) {
    throw new InvalidArgumentError(
      `Expected ${Object.keys(PIPELINE_TARGET_PRESETS).join(", ")} or a number from 0 to 100.`
    );
  }
  return score;
}

/**
 * Parses `--concurrency`: a whole number of at least 1.
 *
 * @param value - The flag's value.
 * @throws InvalidArgumentError otherwise.
 */
function parseConcurrency(value: string) {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new InvalidArgumentError("Expected a whole number of at least 1.");
  }
  return Number(value);
}

/**
 * Parses `--diff`: a path ending in `.png`, since the diff map is a PNG.
 *
 * @param value - The flag's value.
 * @throws InvalidArgumentError otherwise.
 */
function parseDiffPath(value: string) {
  if (path.extname(value).toLowerCase() !== ".png") {
    throw new InvalidArgumentError(
      "The diff map is a PNG, so its path must end in .png."
    );
  }
  return value;
}

/**
 * Gives a command the optimise command's arguments, flags, help and action.
 *
 * @param command - The command: the program itself, or its `optimise` subcommand.
 * @param io - Where to write.
 * @param finish - Receives the exit code.
 */
function defineOptimise(
  command: Command,
  io: CliIo,
  finish: (exitCode: number) => void
) {
  command
    .argument("[inputs...]", "image files, folders and glob patterns")
    .addOption(
      new Option("--to <mode>", "what to write")
        .choices(PIPELINE_MODES)
        .default("webp")
    )
    .option(
      "--target <preset|number>",
      "the lowest quality an output may have",
      parseTarget,
      "high"
    )
    .option(
      "--out-dir <dir>",
      "write into this folder, mirroring the subfolders of folders and globs"
    )
    .option("--in-place", "let an output replace its own input")
    .option("--overwrite", "let an output replace an existing file")
    .option("--recursive", "include the subfolders of folders")
    .option("--dry-run", "work everything out but write nothing")
    .addOption(
      new Option("--json", "print one RunResult as JSON").conflicts("ndjson")
    )
    .option("--ndjson", "print one JSON event per line as the run goes")
    .option("--markup", "print <picture> markup for each file (suite only)")
    .option(
      "--concurrency <n>",
      "how many files to optimise at once (default: one fewer than the CPUs)",
      parseConcurrency
    )
    .addHelpText("after", OPTIMISE_HELP)
    .action(async (inputs: string[], flags: OptimiseFlags, self: Command) => {
      finish(await runOptimise(inputs, flags, io, self));
    });
}

/**
 * Creates the `wio` program: optimise as the default command (also named `optimise` and
 * `optimize`), and `compare`.
 *
 * @param io - Where to write.
 * @param finish - Receives the exit code.
 */
function createProgram(io: CliIo, finish: (exitCode: number) => void) {
  const program = new Command("wio");

  program
    .description(
      "Strips images' metadata and writes the smallest PNG, JPEG, WebP, AVIF or SVG that stays above an SSIMULACRA 2 quality target."
    )
    .usage("[optimise] <inputs...> [options]")
    .version(runTool().version)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      writeErr: (text) => io.stderr.write(text),
    })
    .showHelpAfterError("(run wio --help for usage)")
    .enablePositionalOptions(); // so compare's --json isn't taken as the program's
  defineOptimise(program, io, finish);
  defineOptimise(
    program
      .command("optimise")
      .alias("optimize")
      .description("optimise images; the default command"),
    io,
    finish
  );
  program
    .command("compare")
    .description(
      "score a candidate image against its original with SSIMULACRA 2"
    )
    .argument("<original>", "the original image")
    .argument("<candidate>", "the image to score against it")
    .option(
      "--diff <file.png>",
      "write a heat map of where they differ",
      parseDiffPath
    )
    .option("--overwrite", "let the diff map replace an existing file")
    .option("--json", "print one CompareResult as JSON")
    .addHelpText("after", COMPARE_HELP)
    .action(
      async (original: string, candidate: string, flags: CompareFlags) => {
        finish(await runCompare(original, candidate, flags, io));
      }
    );
  return program;
}

/**
 * Runs the `wio` command line with the given arguments.
 *
 * Results go to stdout: a table, or JSON with `--json` or `--ndjson`. Errors, usage messages
 * and progress go to stderr. It never prompts.
 *
 * @param argv - The arguments, without the node and script paths.
 * @param io - Where to write, what the terminal supports, and a signal that stops the run.
 * @returns The exit code: 0 when nothing failed, 1 when a file or comparison failed, and 2 for
 * a usage error. Rejects with the signal's reason when stopped.
 *
 * @example
 * ```ts
 * import { runCli } from "../cli/index.js";
 *
 * process.exitCode = await runCli(process.argv.slice(2), {
 *   stdout: process.stdout,
 *   stderr: process.stderr,
 *   color: false,
 *   progress: false,
 * });
 * ```
 */
async function runCli(argv: string[], io: CliIo) {
  let exitCode = 0;
  const program = createProgram(io, (code) => {
    exitCode = code;
  });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (!(error instanceof CommanderError)) {
      throw error;
    }
    return error.exitCode === 0 ? 0 : EXIT_USAGE; // help and --version exit 0
  }
  return exitCode;
}

export default runCli;
