import path from "node:path";
import {
  Command,
  CommanderError,
  Help,
  InvalidArgumentError,
  Option,
} from "commander";
import {
  PIPELINE_MODES,
  PIPELINE_RIGHTS_OPTIONS,
  PIPELINE_TARGET_PRESETS,
  isWebUrl,
} from "../pipeline/index.js";
import type { PipelineTargetPreset } from "../pipeline/index.js";
import toolVersions from "../pipeline/toolVersions.js";
import { METADATA_SUMMARY } from "../rights/index.js";
import runCompare from "./runCompare.js";
import type { CompareFlags } from "./runCompare.js";
import runOptimise from "./runOptimise.js";
import type { OptimiseFlags } from "./runOptimise.js";
import type { CliIo } from "./types.js";

const EXIT_USAGE = 2;

const DOCS_URL =
  "https://github.com/miniscoggs/web-image-optimiser/blob/main/docs/cli.md";

const HELP_WIDTH = 80; // fixed, so the help reads the same in any terminal and when piped

const EXAMPLE_WIDTH = 41; // the longest example command that shares a line with its text

/**
 * Wraps help text at {@link HELP_WIDTH} columns, breaking at spaces, with every line after the
 * first indented as far as the text on the first.
 *
 * @param text - The text, on one line.
 * @param prefix - What the first line starts with, such as an indented label.
 */
function wrapHelp(text: string, prefix = "  ") {
  const indent = " ".repeat(prefix.length);
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(" ")) {
    const start = lines.length === 0 ? prefix : indent;

    if (line !== "" && `${start}${line} ${word}`.length > HELP_WIDTH) {
      lines.push(`${start}${line}`);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  lines.push(`${lines.length === 0 ? prefix : indent}${line}`);
  return lines.join("\n");
}

/**
 * Formats a help list: each label padded to one column, beside its text wrapped with
 * {@link wrapHelp}. A label wider than the column gets a line of its own, with its text below.
 *
 * @param items - Each label and its text, which may be empty.
 * @param labelWidth - The label column's width (default: the widest label's).
 */
function helpList(
  items: [label: string, text: string][],
  labelWidth = Math.max(...items.map(([label]) => label.length))
) {
  const indent = " ".repeat(labelWidth + 4);

  return items
    .map(([label, text]) => {
      if (text === "") {
        return `  ${label}`;
      }
      return label.length > labelWidth
        ? `  ${label}\n${wrapHelp(text, indent)}`
        : wrapHelp(text, `  ${label.padEnd(labelWidth)}  `);
    })
    .join("\n");
}

/**
 * Returns the optimise command's help after its options, with the metadata wording the desktop
 * app shares.
 */
function optimiseHelp() {
  const modes = helpList([
    ["webp", "a WebP (the default)"],
    ["avif", "an AVIF"],
    [
      "same",
      "each file in its own format, re-encoded or only stripped, whichever is smaller",
    ],
    [
      "suite",
      "an AVIF, a WebP and a JPEG or PNG fallback, each kept only when it's smaller than the one below it",
    ],
  ]);
  const metadata = helpList([
    ["Kept", METADATA_SUMMARY.kept],
    ["Removed", METADATA_SUMMARY.removed],
    ["SVGs", METADATA_SUMMARY.svg],
  ]);
  const examples = helpList(
    [
      ["wio photos", "WebP beside each image in photos/"],
      [
        "wio photos --recursive --out-dir web",
        "subfolders too, mirrored into web/",
      ],
      ['wio "src/**/*.png" --to same --in-place', "shrink PNGs where they are"],
      ["wio hero.jpg --to suite --out-dir web", "AVIF, WebP and a fallback"],
      [
        "wio photos --max-width 1600 --out-dir web",
        "photos cut down to 1600 px wide",
      ],
      [
        'wio photos --copyright "Copyright 2026 Example Ltd" --out-dir web',
        "add a copyright where there's none",
      ],
      ["wio photos --dry-run --json", "what would be written, as JSON"],
      ["wio compare photo.png photo.webp --diff diff.png", ""],
    ],
    EXAMPLE_WIDTH
  );
  const exitCodes = helpList([
    ["0", "no file failed (skipped and kept-original files are not failures)"],
    ["1", "at least one file failed"],
    ["2", "usage error, including E_NO_INPUTS"],
    ["130", "stopped by Ctrl+C (143 for SIGTERM)"],
    ["141", "stopped because its output closed, such as a pipe into head"],
  ]);

  return `
Modes:
${modes}
${wrapHelp("webp and avif write their best even below the target (W_TARGET_NOT_REACHED); same and suite write only outputs that reach it. SVGs are always optimised as SVG.")}

Targets:
${wrapHelp("SSIMULACRA 2 scores: visually-lossless (90), excellent (85), high (80) or web (70), or any number from 0 to 100. SVGs always use 90.")}

Outputs:
${wrapHelp("Each output is named after its input, with its format's extension, beside the input or in --out-dir. None is larger than its input: when nothing in the format asked for is smaller, the input is written in its own format, usually only stripped (W_NOT_CONVERTED), or left alone (kept-original). An existing file is skipped (W_OUTPUT_EXISTS) unless --overwrite is given.")}

${wrapHelp("Without --out-dir, an output that would replace its input fails with E_OUTPUT_IS_INPUT unless --in-place is given: every file in same mode, a file already in the format asked for, such as a WebP in webp mode, and most files in suite.")}

Inputs:
${wrapHelp('Quote glob patterns, such as "src/**/*.png", so wio expands them the same way on every shell. Folders give their top-level images, and their subfolders too with --recursive.')}

Metadata:
${metadata}
${wrapHelp("--strip-all removes the kept fields too; --creator, --credit, --copyright, --rights-url and --licensor-url add fields a file lacks.")}

Examples:
${examples}

Exit codes:
${exitCodes}

More: ${DOCS_URL}`;
}

/** Returns the compare command's help after its options. */
function compareHelp() {
  return `
${wrapHelp("Scores run up to 100, for identical pixels. Verdicts: visually-lossless (90+), excellent (85+), very-high (80+), high (70+), noticeable (50+), obvious (below 50). The images must be the same size, and SVGs can't be compared. --diff writes a PNG heat map, hotter where the images differ more.", "")}

${wrapHelp("Exit codes: 0 when compared, 1 when the comparison failed, 2 for a usage error.", "")}`;
}

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
 * Parses `--concurrency` and `--max-width`: a whole number of at least 1.
 *
 * @param value - The flag's value.
 * @throws InvalidArgumentError otherwise.
 */
function parseCount(value: string) {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new InvalidArgumentError("Expected a whole number of at least 1.");
  }
  return Number(value);
}

/**
 * Parses `--creator`, `--credit` and `--copyright`: any text but spaces alone.
 *
 * @param value - The flag's value.
 * @throws InvalidArgumentError otherwise.
 */
function parseText(value: string) {
  if (value.trim() === "") {
    throw new InvalidArgumentError("Expected some text.");
  }
  return value;
}

/**
 * Parses `--rights-url` and `--licensor-url`: an absolute `http:` or `https:` URL.
 *
 * @param value - The flag's value.
 * @throws InvalidArgumentError otherwise.
 */
function parseUrl(value: string) {
  if (!isWebUrl(value.trim())) {
    throw new InvalidArgumentError(
      "Expected an http: or https: URL, such as https://example.com/licence."
    );
  }
  return value;
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
    .argument(
      "[inputs...]",
      "image files, folders and glob patterns (see Inputs)"
    )
    .addOption(
      new Option(
        "--to <mode>",
        'what to write: webp, avif, same or suite (see Modes; default: "webp")'
      )
        .choices(PIPELINE_MODES)
        .default("webp")
    )
    .option(
      "--target <preset|number>",
      'the lowest quality an output may have (see Targets; default: "high")',
      parseTarget,
      "high"
    )
    .option(
      "--max-width <px>",
      "shrink wider images to this width first; narrower images and SVGs stay as they are",
      parseCount
    )
    .option(
      "--out-dir <dir>",
      "write here instead of beside each input, mirroring the subfolders of folders and globs"
    )
    .option("--in-place", "let an output replace its own input")
    .option("--overwrite", "let an output replace another existing file")
    .option("--recursive", "include the subfolders of folder inputs")
    .option("--dry-run", "work everything out, but write nothing")
    .addOption(
      new Option(
        "--json",
        "print one RunResult as JSON on stdout when the run ends"
      ).conflicts("ndjson")
    )
    .option(
      "--ndjson",
      "print one JSON event per line on stdout as the run goes"
    )
    .option(
      "--concurrency <n>",
      "files to optimise at once (default: one fewer than the CPUs, at most one per 4 GiB of memory)",
      parseCount
    )
    .addOption(
      new Option(
        "--strip-all",
        "remove all metadata, the copyright and licence fields too"
      ).conflicts([...PIPELINE_RIGHTS_OPTIONS]) // commander names each rights flag's value after its option key
    )
    .option(
      "--creator <name>",
      "add a Creator where a file has none",
      parseText
    )
    .option(
      "--credit <text>",
      "add a Credit Line where a file has none",
      parseText
    )
    .option(
      "--copyright <text>",
      "add a Copyright Notice where a file has none",
      parseText
    )
    .option(
      "--rights-url <url>",
      "add a Web Statement of Rights (the licence's URL) where a file has none",
      parseUrl
    )
    .option(
      "--licensor-url <url>",
      "add a Licensor URL (where to license the image) where a file has none",
      parseUrl
    )
    .addHelpText("after", optimiseHelp)
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
      "Strips images' metadata, keeping copyright and licence fields, and writes the smallest PNG, JPEG, WebP, AVIF or SVG that stays above an SSIMULACRA 2 quality target."
    )
    .usage("[optimise] <inputs...> [options]")
    .version(toolVersions().version)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      writeErr: (text) => io.stderr.write(text),
    })
    .showHelpAfterError("(run wio --help for usage)")
    .configureHelp({
      helpWidth: HELP_WIDTH,
      optionDescription: (option) => option.description, // each states its own default and choices
      subcommandTerm: (command) =>
        new Help().subcommandTerm(command).replace(" [options]", ""), // narrows the option column, leaving it room to wrap
    })
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
    .addHelpText("after", compareHelp)
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
