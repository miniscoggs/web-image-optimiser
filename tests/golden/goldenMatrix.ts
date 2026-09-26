import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, assert, beforeAll, describe, expect, it } from "vitest";
import { inspect } from "../../src/inspect/index.js";
import { isOpaque } from "../../src/metrics/composite.js";
import { decodeForScoring, score } from "../../src/metrics/index.js";
import { optimiseFile } from "../../src/pipeline/index.js";
import type {
  PipelineFileResult,
  PipelineMode,
  PipelineOutputRole,
} from "../../src/pipeline/index.js";
import { fileResultSchema } from "../../src/schema/contract.js";
import type { OptimiserWarningCode } from "../../src/schema/index.js";
import { stripLossless } from "../../src/strip/index.js";
import { stripSvg } from "../../src/svg/index.js";
import { fixturePath, fixtures } from "../fixtureManifest.js";
import type { FixtureEntry } from "../fixtureManifest.js";

type GoldenResult = {
  status: PipelineFileResult["status"];
  error?: string;
  warnings: string[];
  outputs: {
    role: PipelineOutputRole;
    format: string;
    method: string;
    quality?: number;
    bytes: number;
  }[];
};

const TARGET = 80; // the default
const SVG_TARGET = 90;
const ROLE_ORDER: PipelineOutputRole[] = ["avif", "webp", "fallback"];
const QUALITY_TOLERANCE = 3;
const BYTES_TOLERANCE = 0.1;
const GOLDEN_FILE = new URL("golden.json", import.meta.url);

// largest first, so dealing them out gives each shard one photo
const MATRIX_FIXTURES = fixtures.toSorted(
  (first, second) => second.width * second.height - first.width * first.height
);
const golden = JSON.parse(await readFile(GOLDEN_FILE, "utf8")) as {
  target: number;
  modes: Record<PipelineMode, Record<string, GoldenResult>>;
};

/**
 * Returns a SHA-256 of a file's bytes.
 *
 * @param bytes - The bytes.
 */
function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Returns whether a result carries a warning.
 *
 * @param result - The file's result.
 * @param code - The warning code.
 */
function hasWarning(result: PipelineFileResult, code: OptimiserWarningCode) {
  return result.warnings.some((warning) => warning.code === code);
}

/**
 * Returns whether a fixture has any metadata to strip.
 *
 * @param fixture - The fixture.
 * @param bytes - Its bytes.
 */
async function hasSomethingToStrip(fixture: FixtureEntry, bytes: Buffer) {
  if (fixture.format === "svg") {
    return (await stripSvg(bytes)).removed.length > 0;
  }

  const { removed } = stripLossless(bytes, {
    format: fixture.format,
    orientation: fixture.orientation,
  });

  return removed.length > 0;
}

/**
 * Checks one output of a raster fixture: the written file, its metadata, dimensions, alpha
 * and score.
 *
 * @param fixture - The fixture.
 * @param output - The output.
 * @param source - The fixture's decoded pixels.
 */
async function expectRasterOutput(
  fixture: FixtureEntry,
  output: PipelineFileResult["outputs"][number],
  source: Awaited<ReturnType<typeof decodeForScoring>>
) {
  const written = await readFile(output.path);
  const info = await inspect(written);
  const kept =
    output.method === "strip" && fixture.orientation !== 1 ? ["exif"] : [];
  const keptIcc =
    output.method === "strip" && fixture.icc === "non-srgb" ? "non-srgb" : null;

  expect(written.length).toBe(output.bytes);
  expect(info).toMatchObject({
    format: output.format,
    width: fixture.width,
    height: fixture.height,
    icc: keptIcc,
    metadata: kept,
  });
  if (!isOpaque(source)) {
    expect(info.hasAlpha).toBe(true);
  }
  expect(await score(source, await decodeForScoring(written))).toBe(
    output.score
  );
}

/**
 * Checks the rules every result must follow, whatever the fixture and mode.
 *
 * @param fixture - The fixture.
 * @param mode - The mode.
 * @param result - The file's result.
 * @param bytes - The fixture's bytes.
 */
async function expectRules(
  fixture: FixtureEntry,
  mode: PipelineMode,
  result: PipelineFileResult,
  bytes: Buffer
) {
  const isSvg = fixture.format === "svg";
  const target = isSvg ? SVG_TARGET : TARGET;
  const { outputs } = result;
  const roles = outputs.map((output) => output.role);

  expect(["optimised", "kept-original"]).toContain(result.status);
  expect(result.status === "kept-original").toBe(outputs.length === 0);
  if (result.status === "kept-original") {
    expect(await hasSomethingToStrip(fixture, bytes)).toBe(false);
  }

  for (const output of outputs) {
    const unchangedFallback =
      output.role === "fallback" && output.bytes === bytes.length;

    expect(output.bytes < bytes.length || unchangedFallback).toBe(true);
    expect(output.strippedMetadata).toEqual(
      expect.arrayContaining(fixture.metadata)
    );
    expect(
      output.score >= target || hasWarning(result, "W_TARGET_NOT_REACHED")
    ).toBe(true);
  }

  expect(hasWarning(result, "W_NOTICEABLE")).toBe(
    outputs.some((output) => output.score < 80)
  );
  expect(hasWarning(result, "W_SVG_SAME_ONLY")).toBe(isSvg && mode !== "same");
  expect(hasWarning(result, "W_TOO_SMALL_TO_SCORE")).toBe(
    !isSvg && Math.min(fixture.width, fixture.height) < 8
  );
  expect(hasWarning(result, "W_NOT_CONVERTED")).toBe(
    !isSvg &&
      (mode === "webp" || mode === "avif") &&
      fixture.format !== mode &&
      !roles.includes(mode)
  );
  expect(hasWarning(result, "W_ICC_KEPT")).toBe(
    fixture.icc === "non-srgb" &&
      (outputs.length === 0 ||
        outputs.some((output) => output.method === "strip"))
  );

  if (isSvg || mode === "same") {
    expect(roles.every((role) => role === "same")).toBe(true);
  } else if (mode === "suite") {
    const sizes = outputs.map((output) => output.bytes);
    const fallback = outputs.find((output) => output.role === "fallback");

    expect(roles).toEqual(ROLE_ORDER.filter((role) => roles.includes(role)));
    expect(sizes).toEqual(sizes.toSorted((first, second) => first - second));
    expect(new Set(sizes).size).toBe(sizes.length);
    if (fallback !== undefined) {
      expect(["jpeg", "png"]).toContain(fallback.format);
    }
  } else {
    expect(roles).toEqual([expect.stringMatching(`^(${mode}|same)$`)]);
  }
}

/**
 * Returns the golden value when a measured one is within a tolerance of it, so a failing
 * comparison shows only the values out of tolerance.
 *
 * @param measured - The measured value.
 * @param expected - The golden value.
 * @param tolerance - How far from it the measured value may be.
 */
function withinTolerance(
  measured: number,
  expected: number | undefined,
  tolerance: number
) {
  return expected !== undefined && Math.abs(measured - expected) <= tolerance
    ? expected
    : measured;
}

/**
 * Checks a result against its golden entry: the status, error, warnings, and each output's
 * role, format and method exactly, its quality within 3 and its size within 10%.
 *
 * @param result - The file's result.
 * @param expected - Its golden entry.
 */
function expectGolden(result: PipelineFileResult, expected: GoldenResult) {
  const outputs = result.outputs.map((output, index) => {
    const goldenOutput = expected.outputs[index];
    const bytesTolerance = (goldenOutput?.bytes ?? 0) * BYTES_TOLERANCE;

    return {
      role: output.role,
      format: output.format,
      method: output.method,
      ...(output.quality === undefined
        ? {}
        : {
            quality: withinTolerance(
              output.quality,
              goldenOutput?.quality,
              QUALITY_TOLERANCE
            ),
          }),
      bytes: withinTolerance(output.bytes, goldenOutput?.bytes, bytesTolerance),
    };
  });

  expect({
    status: result.status,
    ...(result.error === undefined ? {} : { error: result.error.code }),
    warnings: result.warnings.map((warning) => warning.code),
    outputs,
  }).toEqual(expected);
}

/**
 * Runs fixtures through one mode into a temp folder, checking every rule the pipeline promises
 * for each, and what it decides against `golden.json`.
 *
 * @param mode - The mode.
 * @param shard - Which share of the fixtures to run, and of how many, so a slow mode can be
 * spread over several files that run in parallel.
 */
function describeMode(mode: PipelineMode, shard: [number, number] = [1, 1]) {
  const [part, parts] = shard;
  const shardFixtures = MATRIX_FIXTURES.filter(
    (_fixture, index) => index % parts === part - 1
  );

  describe(`optimiseFile with to: "${mode}" (${part} of ${parts})`, () => {
    let outDir = "";

    it("uses the target the golden results were made with", () => {
      expect(golden.target).toBe(TARGET);
    });

    beforeAll(async () => {
      outDir = await mkdtemp(path.join(tmpdir(), `wio-${mode}-${part}-`));
    });
    afterAll(async () => {
      expect(
        (await readdir(outDir)).filter((name) => name.endsWith(".tmp"))
      ).toEqual([]);
      await rm(outDir, { recursive: true, force: true });
    });

    // a photo in avif or suite mode takes ~3 min here, and the intel mac runner is ~3x slower
    it.each(shardFixtures)("$file", { timeout: 1_200_000 }, async (fixture) => {
      const input = fixturePath(fixture.file);
      const bytes = await readFile(input);
      const result = await optimiseFile(input, { to: mode, outDir });
      const expected = golden.modes[mode][fixture.file];

      expect(fileResultSchema.parse(result)).toEqual(result); // parsing drops fields the contract lacks
      assert(expected, "no golden result; run node scripts/update-golden.mjs");
      expectGolden(result, expected);
      expect(hash(await readFile(input))).toBe(hash(bytes));
      if (fixture.animated) {
        expect(result).toMatchObject({
          status: "failed",
          error: { code: "E_ANIMATED" },
        });
        return;
      }

      await expectRules(fixture, mode, result, bytes);
      if (fixture.format === "svg") {
        for (const output of result.outputs) {
          const written = await readFile(output.path);

          expect(written.length).toBe(output.bytes);
          expect((await inspect(written)).metadata).toEqual([]);
          expect(output.gzipBytes).toBeGreaterThan(0);
        }
        return;
      }

      const source = await decodeForScoring(bytes);

      for (const output of result.outputs) {
        await expectRasterOutput(fixture, output, source);
      }
    });
  });
}

export default describeMode;
