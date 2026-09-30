import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";
import type { CliIo } from "../../src/cli/index.js";
import { METRICS_VERDICTS } from "../../src/metrics/types.js";
import {
  compareResultSchema,
  eventSchema,
  runResultSchema,
} from "../../src/schema/contract.js";
import { fixturePath } from "../fixtureManifest.js";

const PAIR_DIR = new URL("../../fixtures/ssimulacra2/", import.meta.url);

const OPTIMISE_FLAGS = [
  "--to <mode>",
  "--target <preset|number>",
  "--max-width <px>",
  "--out-dir <dir>",
  "--in-place",
  "--overwrite",
  "--recursive",
  "--dry-run",
  "--json",
  "--ndjson",
  "--concurrency <n>",
  "--strip-all",
  "--creator <name>",
  "--credit <text>",
  "--copyright <text>",
  "--rights-url <url>",
  "--licensor-url <url>",
];

let folder = "";

/**
 * Runs the CLI in-process, capturing what it writes.
 *
 * @param argv - The arguments.
 * @param io - Changes to the default terminal: no colour, no progress.
 */
async function run(argv: string[], io: Partial<CliIo> = {}) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(argv, {
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
    color: false,
    progress: false,
    ...io,
  });

  return { exitCode, stdout, stderr };
}

/**
 * Copies fixtures into the test folder, or a subfolder of it.
 *
 * @param files - The fixtures' file names.
 * @param subfolder - The subfolder.
 */
async function copyFixtures(files: string[], subfolder = "") {
  const target = path.join(folder, subfolder);

  await mkdir(target, { recursive: true });
  for (const file of files) {
    await copyFile(fixturePath(file), path.join(target, file));
  }
  return target;
}

/**
 * Lists every file under a folder, relative to it, or none when it doesn't exist.
 *
 * @param directory - The folder.
 */
async function listFiles(directory: string) {
  const entries = await readdir(directory, { recursive: true }).catch(() => []);

  return entries.toSorted();
}

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "wio cli é-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("wio optimise", () => {
  it("prints exactly one RunResult with --json and exits 0", async () => {
    const images = await copyFixtures(["icon-6x6.png", "title-viewbox.svg"]);
    const outDir = path.join(folder, "web");
    const { exitCode, stdout, stderr } = await run([
      images,
      "--out-dir",
      outDir,
      "--json",
    ]);
    const result = runResultSchema.parse(JSON.parse(stdout));

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.endsWith("}\n")).toBe(true);
    expect(stdout.trimEnd()).not.toContain("\n");
    expect(result.options).toMatchObject({ to: "webp", target: 80, outDir });
    expect(result.files).toMatchObject([
      { status: "optimised", width: 6, height: 6 },
      { status: "optimised", outputs: [{ format: "svg" }] },
    ]);
    expect(await listFiles(outDir)).toEqual([
      "icon-6x6.webp",
      "title-viewbox.svg",
    ]);
  });

  it("prints one event per line with --ndjson", async () => {
    const images = await copyFixtures(["icon-6x6.png"]);
    const { exitCode, stdout } = await run([
      images,
      "--out-dir",
      path.join(folder, "web"),
      "--ndjson",
    ]);
    const events = stdout
      .trimEnd()
      .split("\n")
      .map((line) => eventSchema.parse(JSON.parse(line)));

    expect(exitCode).toBe(0);
    expect(events.map((event) => event.type)).toEqual([
      "run-start",
      "file-start",
      "file-done",
      "run-done",
    ]);
  });

  it("prints a table, and exits 1 when a file fails", async () => {
    const images = await copyFixtures(["animated.webp", "icon-6x6.png"]);
    const { exitCode, stdout } = await run([
      images,
      "--out-dir",
      path.join(folder, "web"),
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/^File +Output +Format/);
    expect(stdout).toContain("E_ANIMATED");
    expect(stdout).toContain("2 files: 1 optimised, 1 failed.");
    expect(stdout).not.toContain("\u001b[");
  });

  it("adds colour when the terminal has it", async () => {
    const images = await copyFixtures(["icon-6x6.png"]);
    const { stdout } = await run(
      [images, "--out-dir", path.join(folder, "web")],
      { color: true }
    );

    expect(stdout).toContain("\u001b[");
    expect(stripVTControlCharacters(stdout)).toContain("visually-lossless");
  });

  it("redraws a progress line on stderr, and clears it at the end", async () => {
    const images = await copyFixtures(["icon-6x6.png"]);
    const { stderr } = await run(
      [images, "--out-dir", path.join(folder, "web"), "--json"],
      { progress: true }
    );

    expect(stderr).toContain("wio: 1 of 1 files done");
    expect(stderr.endsWith("\r\u001b[2K")).toBe(true);
  });

  it("suggests the flags that fix E_OUTPUT_IS_INPUT and W_OUTPUT_EXISTS", async () => {
    const images = await copyFixtures(["icon-6x6.png", "title-viewbox.svg"]);
    const first = await run([images, "--json"]);
    const second = await run([images, "--json"]);
    const [icon, svg] = runResultSchema.parse(JSON.parse(second.stdout)).files;

    expect(first.exitCode).toBe(1); // the svg stays svg, so it would replace itself
    expect(svg?.error?.message).toContain("(--out-dir <dir> or --in-place)");
    expect(icon?.status).toBe("skipped");
    expect(icon?.warnings[0]?.message).toContain("(--overwrite)");

    const overwritten = await run([images, "--overwrite", "--in-place"]);

    expect(overwritten.exitCode).toBe(0);
  });

  it("shrinks wider images with --max-width, reporting it in the options", async () => {
    const images = await copyFixtures(["logo-alpha.png"]);
    const { exitCode, stdout } = await run([
      images,
      "--max-width",
      "160",
      "--dry-run",
      "--json",
    ]);
    const result = runResultSchema.parse(JSON.parse(stdout));

    expect(exitCode).toBe(0);
    expect(result.options.maxWidth).toBe(160);
    expect(result.files).toMatchObject([
      { width: 320, height: 160, outputs: [{ width: 160, height: 80 }] },
    ]);
  });

  it("adds the rights flags' fields, echoing them in the options", async () => {
    const images = await copyFixtures(["logo-alpha.png"]);
    const { exitCode, stdout } = await run([
      images,
      "--copyright",
      " Copyright Example Ltd ",
      "--rights-url",
      "https://example.com/licence",
      "--dry-run",
      "--json",
    ]);
    const result = runResultSchema.parse(JSON.parse(stdout));

    expect(exitCode).toBe(0);
    expect(result.options).toMatchObject({
      stripAll: false,
      rights: {
        copyright: "Copyright Example Ltd",
        rightsUrl: "https://example.com/licence",
      },
    });
    expect(result.files).toMatchObject([
      {
        outputs: [
          {
            rights: {
              copyright: [
                { lang: "x-default", value: "Copyright Example Ltd" },
              ],
              webStatement: "https://example.com/licence",
            },
            rightsAdded: ["copyright", "webStatement"],
          },
        ],
        warnings: [],
      },
    ]);
  });

  it("removes every field with --strip-all, without W_NO_RIGHTS", async () => {
    const images = await copyFixtures(["logo-alpha.png"]);
    const { stdout } = await run([
      images,
      "--strip-all",
      "--dry-run",
      "--json",
    ]);
    const result = runResultSchema.parse(JSON.parse(stdout));

    expect(result.options.stripAll).toBe(true);
    expect(result.files).toMatchObject([{ warnings: [] }]);
  });

  it("names the flags that fix W_NO_RIGHTS, per file in the JSON and once in the table", async () => {
    const images = await copyFixtures(["icon-6x6.png", "logo-alpha.png"]);
    const json = await run([images, "--dry-run", "--json"]);
    const table = await run([images, "--dry-run"]);
    const { files } = runResultSchema.parse(JSON.parse(json.stdout));
    const noRights = files.flatMap((file) =>
      file.warnings.filter((warning) => warning.code === "W_NO_RIGHTS")
    );

    expect(noRights).toHaveLength(2);
    expect(noRights[0]?.message).toContain("--copyright");
    expect(noRights[0]?.message).toContain("--strip-all");
    expect(table.stdout.match(/W_NO_RIGHTS/g)).toHaveLength(1);
    expect(table.stdout).toContain(
      "W_NO_RIGHTS 2 files have no copyright or licence metadata ("
    );
  });

  it("writes nothing with --dry-run", async () => {
    const images = await copyFixtures(["icon-6x6.png"]);
    const { exitCode, stdout } = await run([images, "--dry-run"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Dry run: nothing was written.");
    expect(await listFiles(images)).toEqual(["icon-6x6.png"]);
  });

  it.each([["optimise"], ["optimize"]])(
    "runs the same as the %s command",
    async (name) => {
      const images = await copyFixtures(["icon-6x6.png"]);
      const { exitCode, stdout } = await run([
        name,
        images,
        "--dry-run",
        "--json",
      ]);

      expect(exitCode).toBe(0);
      expect(runResultSchema.parse(JSON.parse(stdout)).files).toHaveLength(1);
    }
  );

  it.each([
    ["no inputs", []],
    ["an unknown flag", ["image.png", "--bogus"]],
    ["--json with --ndjson", ["image.png", "--json", "--ndjson"]],
    ["an unknown mode", ["image.png", "--to", "gif"]],
    ["a target over 100", ["image.png", "--target", "101"]],
    ["an unknown target preset", ["image.png", "--target", "best"]],
    ["a concurrency of 0", ["image.png", "--concurrency", "0"]],
    ["a max width of 0", ["image.png", "--max-width", "0"]],
    ["a fractional max width", ["image.png", "--max-width", "1.5"]],
    ["a max width that isn't a number", ["image.png", "--max-width", "wide"]],
    [
      "--strip-all with a rights flag",
      ["image.png", "--strip-all", "--credit", "x"],
    ],
    [
      "a rights flag with --strip-all",
      ["image.png", "--licensor-url", "https://example.com", "--strip-all"],
    ],
    ["a creator of spaces alone", ["image.png", "--creator", "  "]],
    [
      "a rights URL that isn't http or https",
      ["image.png", "--rights-url", "ftp://example.com/licence"],
    ],
    [
      "a licensor URL that isn't absolute",
      ["image.png", "--licensor-url", "example.com"],
    ],
  ])("exits 2 for %s, printing nothing on stdout", async (_name, argv) => {
    const { exitCode, stdout, stderr } = await run(argv);

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/^error: /);
  });

  it("exits 2 with E_NO_INPUTS for a folder with no images", async () => {
    await mkdir(path.join(folder, "empty"));

    const { exitCode, stderr } = await run([path.join(folder, "empty")]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("E_NO_INPUTS");
  });

  it("prints help with every option and section, and the version, exiting 0", async () => {
    const help = await run(["--help"]);
    const version = await run(["--version"]);
    const headings = [...help.stdout.matchAll(/^(\w[\w ]*):$/gm)].map(
      ([, heading]) => heading
    );

    expect(help).toMatchObject({ exitCode: 0, stderr: "" });
    expect(headings).toEqual([
      "Arguments",
      "Options",
      "Commands",
      "Modes",
      "Targets",
      "Outputs",
      "Inputs",
      "Metadata",
      "Examples",
      "Exit codes",
    ]);
    for (const flag of OPTIMISE_FLAGS) {
      expect(help.stdout).toContain(`\n  ${flag} `);
    }
    expect(version).toMatchObject({ exitCode: 0, stdout: "0.1.0\n" });
  });

  it("says in its help what metadata is kept and removed", async () => {
    const { stdout } = await run(["--help"]);
    const metadata = /\nMetadata:\n([\s\S]*?)\n\n/.exec(stdout)?.[1] ?? "";

    expect(metadata).toMatch(/^ {2}Kept {5}Creator, /);
    expect(metadata).toMatch(/\n {2}Removed {2}everything else: /);
    expect(metadata).toMatch(/\n {2}SVGs {5}keep <title>/);
    expect(metadata).toContain("--strip-all removes the kept fields too");
  });

  it.each(["--help", "optimise --help", "compare --help"])(
    "fits wio %s within 80 columns",
    async (args) => {
      const { stdout } = await run(args.split(" "));

      for (const line of stdout.split("\n")) {
        expect(line.length, line).toBeLessThanOrEqual(80);
      }
    }
  );

  it("rejects with the signal's reason when stopped", async () => {
    const images = await copyFixtures(["icon-6x6.png"]);

    await expect(
      run([images, "--dry-run"], { signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("wio compare", () => {
  const original = fileURLToPath(new URL("butterfly.png", PAIR_DIR));
  const candidate = fileURLToPath(new URL("butterfly-q60.webp", PAIR_DIR));

  it("prints the score, verdict and sizes, and exits 0", async () => {
    const diff = path.join(folder, "diff.png");
    const { exitCode, stdout } = await run([
      "compare",
      original,
      candidate,
      "--diff",
      diff,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(
      /^Score {2}68\.\d, noticeable: slightly annoying artifacts\n/
    );
    expect(stdout).toContain(`Diff   ${diff}\n`);
    expect(await listFiles(folder)).toEqual(["diff.png"]);
  });

  it("gives every verdict's lowest score in its help", async () => {
    const { exitCode, stdout } = await run(["compare", "--help"]);
    const text = stdout.replaceAll(/\s+/g, " ");

    expect(exitCode).toBe(0);
    for (const verdict of METRICS_VERDICTS) {
      expect(text).toMatch(
        new RegExp(` ${verdict} \\((\\d+\\+|below \\d+)\\)`)
      );
    }
  });

  it("prints one CompareResult with --json, with a hint when the diff map exists", async () => {
    const diff = path.join(folder, "diff.png");

    await run(["compare", original, candidate, "--diff", diff]);

    const { exitCode, stdout } = await run([
      "compare",
      original,
      candidate,
      "--diff",
      diff,
      "--json",
    ]);
    const result = compareResultSchema.parse(JSON.parse(stdout));

    expect(exitCode).toBe(0);
    expect(result.warnings[0]?.message).toContain("(--overwrite)");
  });

  it("exits 1 when the comparison fails, with the error on stderr", async () => {
    const { exitCode, stdout, stderr } = await run([
      "compare",
      original,
      fixturePath("logo-alpha.png"),
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/^wio: E_DIMENSIONS_MISMATCH /);
  });

  it("exits 2 for a diff map that isn't a PNG", async () => {
    const { exitCode, stderr } = await run([
      "compare",
      original,
      candidate,
      "--diff",
      "diff.jpg",
    ]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("must end in .png");
  });
});
