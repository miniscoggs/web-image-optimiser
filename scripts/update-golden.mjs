// Rewrites tests/golden/golden.json: what the optimiser decides for every fixture in every mode.
// Run `npm run build` first. Every change it makes is an API change; see the update-image-engine
// skill before committing one. Usage: node scripts/update-golden.mjs
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { optimiseBatch } from "../dist/index.js";

const MODES = ["same", "webp", "avif", "suite"];
const FIXTURE_DIR = new URL("../fixtures/", import.meta.url);
const GOLDEN_FILE = fileURLToPath(
  new URL("../tests/golden/golden.json", import.meta.url)
);

/**
 * Keeps the parts of a file's result that the golden tests compare.
 *
 * @param file - The file's result.
 */
function summarise(file) {
  return {
    status: file.status,
    ...(file.error === undefined ? {} : { error: file.error.code }),
    warnings: file.warnings.map((warning) => warning.code),
    outputs: file.outputs.map(({ role, format, method, quality, bytes }) => ({
      role,
      format,
      method,
      ...(quality === undefined ? {} : { quality }),
      bytes,
    })),
  };
}

const manifest = JSON.parse(
  await readFile(new URL("manifest.json", FIXTURE_DIR), "utf8")
);
const inputs = manifest.fixtures.map(({ file }) =>
  fileURLToPath(new URL(file, FIXTURE_DIR))
);
const outDir = await mkdtemp(path.join(tmpdir(), "wio-golden-"));
const golden = { tool: undefined, target: undefined, modes: {} };

try {
  for (const mode of MODES) {
    const run = await optimiseBatch(inputs, { to: mode, outDir, dryRun: true });

    golden.tool = run.tool;
    golden.target = run.options.target;
    golden.modes[mode] = Object.fromEntries(
      run.files.map((file) => [path.basename(file.input), summarise(file)])
    );
    console.log(`${mode}: ${run.files.length} files`);
  }
} finally {
  await rm(outDir, { recursive: true, force: true });
}

const config = await resolveConfig(GOLDEN_FILE);
const text = await format(JSON.stringify(golden), {
  ...config,
  parser: "json",
});

await writeFile(GOLDEN_FILE, text);
console.log(`Wrote ${GOLDEN_FILE}`);
