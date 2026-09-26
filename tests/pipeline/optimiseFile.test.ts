import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { optimiseFile } from "../../src/pipeline/index.js";
import type {
  PipelineFileResult,
  PipelineMode,
  PipelineTargetPreset,
} from "../../src/pipeline/index.js";
import { stripLossless } from "../../src/strip/index.js";
import { fixturePath } from "../fixtureManifest.js";

const CASE_INSENSITIVE =
  process.platform === "win32" || process.platform === "darwin";

let folder = "";

/**
 * Copies a fixture into the test folder.
 *
 * @param file - The fixture's file name.
 * @param name - The copy's name.
 */
async function copyFixture(file: string, name = file) {
  const target = path.join(folder, name);

  await copyFile(fixturePath(file), target);
  return target;
}

/**
 * Lists a folder's entries, sorted.
 *
 * @param directory - The folder.
 */
async function list(directory = folder) {
  return (await readdir(directory)).toSorted();
}

/**
 * Returns a result's warning codes.
 *
 * @param result - The file's result.
 */
function warningCodes(result: PipelineFileResult) {
  return result.warnings.map((warning) => warning.code);
}

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "wio pipeline é-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("optimiseFile", () => {
  describe("where outputs go", () => {
    it("fails with E_OUTPUT_IS_INPUT when same mode would replace the input", async () => {
      const input = await copyFixture("orientation-6.jpg");
      const before = await readFile(input);
      const result = await optimiseFile(input, { to: "same" });

      expect(result).toMatchObject({
        status: "failed",
        bytes: before.length,
        outputs: [],
        error: { code: "E_OUTPUT_IS_INPUT" },
      });
      expect(await readFile(input)).toEqual(before);
      expect(await list()).toEqual(["orientation-6.jpg"]);
    });

    it("counts an output folder that is the input's own folder as the input", async () => {
      const input = await copyFixture("gradient.png");
      const result = await optimiseFile(input, { to: "same", outDir: folder });

      expect(result.error?.code).toBe("E_OUTPUT_IS_INPUT");
    });

    it.runIf(CASE_INSENSITIVE)(
      "counts the input's folder spelt in another case as the input",
      async () => {
        const input = await copyFixture("gradient.png");
        const outDir = path.join(
          path.dirname(folder),
          path.basename(folder).replace("pipeline", "PIPELINE")
        );
        const result = await optimiseFile(input, { to: "same", outDir });

        expect(result.error?.code).toBe("E_OUTPUT_IS_INPUT");
      }
    );

    it("replaces the input with inPlace, leaving no temp files", async () => {
      const input = await copyFixture("gradient.png");
      const before = await readFile(input);
      const result = await optimiseFile(input, { to: "same", inPlace: true });
      const after = await readFile(input);

      expect(result).toMatchObject({
        status: "optimised",
        outputs: [{ role: "same", path: input, bytes: after.length }],
      });
      expect(after.length).toBeLessThan(before.length);
      expect(await list()).toEqual(["gradient.png"]);
    });

    it("skips a file whose output exists, unless overwrite is set", async () => {
      const input = await copyFixture("gradient-16bit.png");
      const outDir = path.join(folder, "out");
      const output = path.join(outDir, "gradient-16bit.webp");

      await optimiseFile(input, { outDir });
      await writeFile(output, "not an image");

      const skipped = await optimiseFile(input, { outDir });

      expect(skipped).toMatchObject({ status: "skipped", outputs: [] });
      expect(warningCodes(skipped)).toEqual(["W_OUTPUT_EXISTS"]);
      expect(await readFile(output, "utf8")).toBe("not an image");

      const replaced = await optimiseFile(input, { outDir, overwrite: true });

      expect(replaced.status).toBe("optimised");
      expect((await readFile(output)).length).toBe(replaced.outputs[0]?.bytes);
    });

    it("writes nothing in a dry run", async () => {
      const input = await copyFixture("logo-alpha.png");
      const outDir = path.join(folder, "out");
      const result = await optimiseFile(input, {
        to: "avif",
        outDir,
        dryRun: true,
      });

      expect(result).toMatchObject({
        status: "optimised",
        outputs: [{ path: path.join(outDir, "logo-alpha.avif") }],
      });
      expect(await list()).toEqual(["logo-alpha.png"]);
    });

    it("fails once chosen when the strip fallback would replace the input", async () => {
      const input = await copyFixture("exif.avif");
      const before = await readFile(input);
      const result = await optimiseFile(input, { to: "webp" });

      expect(result.error?.code).toBe("E_OUTPUT_IS_INPUT");
      expect(await list()).toEqual(["exif.avif"]);

      const inPlace = await optimiseFile(input, { to: "webp", inPlace: true });

      expect(inPlace).toMatchObject({
        status: "optimised",
        outputs: [{ role: "same", format: "avif", method: "strip" }],
      });
      expect(warningCodes(inPlace)).toEqual(["W_NOT_CONVERTED"]);
      expect((await readFile(input)).length).toBeLessThan(before.length);
    });

    it("leaves a suite's unchanged fallback where it is", async () => {
      const input = await copyFixture("display-p3.jpg");
      const before = await readFile(input);
      const result = await optimiseFile(input, { to: "suite" });

      expect(result.status).toBe("optimised");
      expect(result.outputs.at(-1)).toMatchObject({
        role: "fallback",
        path: input,
        method: "strip",
        bytes: before.length,
        saving: 0,
      });
      expect(await readFile(input)).toEqual(before);
      expect(await list()).toEqual([
        "display-p3.avif",
        "display-p3.jpg",
        "display-p3.webp",
      ]);
    });

    it("keeps an input with nothing to strip that no conversion beats", async () => {
      const icon = await readFile(fixturePath("icon-6x6.png"));
      const input = path.join(folder, "clean-icon.png");
      const outDir = path.join(folder, "out");

      await writeFile(
        input,
        stripLossless(icon, { format: "png", orientation: 1 }).bytes
      );

      const result = await optimiseFile(input, { to: "avif", outDir });

      expect(result).toMatchObject({ status: "kept-original", outputs: [] });
      expect(warningCodes(result)).toEqual([
        "W_TOO_SMALL_TO_SCORE",
        "W_NOT_CONVERTED",
      ]);
      expect(await list()).toEqual(["clean-icon.png"]);
    });

    it("keeps the input's own extension for its format", async () => {
      const input = await copyFixture("gradient.png", "scene.PNG");
      const outDir = path.join(folder, "out");
      const same = await optimiseFile(input, { to: "same", outDir });
      const webp = await optimiseFile(input, { to: "webp", outDir });

      expect(same.outputs[0]?.path).toBe(path.join(outDir, "scene.PNG"));
      expect(webp.outputs[0]?.path).toBe(path.join(outDir, "scene.webp"));
    });

    it("names a misnamed input's outputs by its real format", async () => {
      const input = await copyFixture("gradient.png", "misnamed.jpg");
      const outDir = path.join(folder, "out");
      const result = await optimiseFile(input, { to: "same", outDir });

      expect(result.outputs[0]).toMatchObject({
        format: "png",
        path: path.join(outDir, "misnamed.png"),
      });
    });
  });

  describe("targets", () => {
    it("writes a conversion below an unreachable target, with W_TARGET_NOT_REACHED", async () => {
      const input = fixturePath("display-p3.jpg");
      const result = await optimiseFile(input, {
        target: 95,
        outDir: folder,
      });
      const [output] = result.outputs;

      expect(output?.score).toBeLessThan(95);
      expect(output?.bytes).toBeLessThan(result.bytes ?? 0);
      expect(warningCodes(result)).toEqual(["W_TARGET_NOT_REACHED"]);
    });

    it("warns with W_NOTICEABLE when an output scores below 80", async () => {
      const input = fixturePath("display-p3.jpg");
      const result = await optimiseFile(input, {
        target: "web",
        outDir: folder,
      });

      expect(result.outputs[0]?.score).toBeGreaterThanOrEqual(70);
      expect(result.outputs[0]?.score).toBeLessThan(80);
      expect(result.outputs[0]?.verdict).toBe("high");
      expect(warningCodes(result)).toEqual(["W_NOTICEABLE"]);
    });

    it("rejects an unknown mode or target", async () => {
      const input = fixturePath("gradient.png");

      await expect(optimiseFile(input, { target: 101 })).rejects.toThrow(
        RangeError
      );
      await expect(
        optimiseFile(input, { target: "ultra" as PipelineTargetPreset })
      ).rejects.toThrow(RangeError);
      await expect(
        optimiseFile(input, { to: "gif" as PipelineMode })
      ).rejects.toThrow(RangeError);
    });
  });

  describe("failures", () => {
    it("fails with E_READ when the input can't be read", async () => {
      const result = await optimiseFile(path.join(folder, "missing.png"));

      expect(result).toMatchObject({
        status: "failed",
        error: { code: "E_READ" },
      });
      expect(result).not.toHaveProperty("bytes");
    });

    it("fails with E_UNSUPPORTED_FORMAT for a file that isn't an image", async () => {
      const input = path.join(folder, "notes.png");

      await writeFile(input, "just text");

      const result = await optimiseFile(input, { outDir: folder });

      expect(result.error?.code).toBe("E_UNSUPPORTED_FORMAT");
    });

    it("fails with E_DECODE when the image data is cut short", async () => {
      const gradient = await readFile(fixturePath("gradient.png"));
      const input = path.join(folder, "truncated.png");

      await writeFile(input, gradient.subarray(0, gradient.length / 2));

      const result = await optimiseFile(input, {
        outDir: path.join(folder, "out"),
      });

      expect(result.error?.code).toBe("E_DECODE");
    });

    it("fails with E_WRITE when the output folder can't be created", async () => {
      const input = await copyFixture("gradient-16bit.png");
      const outDir = path.join(folder, "a-file");

      await writeFile(outDir, "");

      const result = await optimiseFile(input, { outDir });

      expect(result.error?.code).toBe("E_WRITE");
    });
  });

  describe("aborting", () => {
    it("rejects straight away when already aborted", async () => {
      const input = fixturePath("gradient.png");
      const signal = AbortSignal.abort();

      await expect(
        optimiseFile(input, { outDir: folder }, { signal })
      ).rejects.toMatchObject({ name: "AbortError" });
    });

    it("rejects mid-search and writes nothing", async () => {
      const input = fixturePath("screenshot.png");
      const outDir = path.join(folder, "out");
      const controller = new AbortController();
      const run = optimiseFile(
        input,
        { to: "suite", outDir },
        { signal: controller.signal }
      );

      setTimeout(() => controller.abort(), 300);
      await expect(run).rejects.toMatchObject({ name: "AbortError" });
      expect(await list()).toEqual([]);
    });
  });
});
