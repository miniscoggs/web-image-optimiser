import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { optimiseBatch } from "../../src/pipeline/index.js";
import type {
  PipelineEvent,
  PipelineRunResult,
} from "../../src/pipeline/index.js";
import { eventSchema, runResultSchema } from "../../src/schema/contract.js";
import { fixturePath } from "../fixtureManifest.js";

let folder = "";

/**
 * Copies fixtures into the test folder, or a subfolder of it.
 *
 * @param copies - Pairs of fixture name and copy path, relative to the test folder.
 */
async function copyFixtures(copies: [string, string][]) {
  const paths = [];

  for (const [file, name] of copies) {
    const target = path.join(folder, name);

    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(fixturePath(file), target);
    paths.push(target);
  }
  return paths;
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

/**
 * Checks a run result, and each event, against the JSON contract, which parsing would strip
 * of any field it lacks.
 *
 * @param result - The run's result.
 * @param events - Its events.
 */
function expectContract(result: PipelineRunResult, events: PipelineEvent[]) {
  expect(runResultSchema.parse(result)).toEqual(result);
  for (const event of events) {
    expect(eventSchema.parse(event)).toEqual(event);
  }
}

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "wio batch é-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("optimiseBatch", () => {
  it("optimises every input, reporting results in input order with totals and events", async () => {
    const inputs = await copyFixtures([
      ["gradient-16bit.png", "gradient-16bit.png"],
      ["animated.webp", "animated.webp"],
      ["title-viewbox.svg", "title-viewbox.svg"],
      ["icon-6x6.png", "icon-6x6.png"],
    ]);
    const outDir = path.join(folder, "out");
    const events: PipelineEvent[] = [];
    const result = await optimiseBatch(
      inputs,
      { outDir },
      { concurrency: 2, onEvent: (event) => events.push(event) }
    );
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8")
    ) as { version: string };
    const optimised = result.files.filter(
      (file) => file.status === "optimised"
    );

    expectContract(result, events);
    expect(result).toMatchObject({
      schemaVersion: 1,
      tool: {
        version: manifest.version,
        sharp: sharp.versions.sharp,
        libvips: sharp.versions.vips,
      },
      options: {
        to: "webp",
        target: 80,
        outDir,
        inPlace: false,
        overwrite: false,
        dryRun: false,
        concurrency: 2,
      },
    });
    expect(result.files.map((file) => file.input)).toEqual(inputs);
    expect(result.files.map((file) => file.status)).toEqual([
      "optimised",
      "failed",
      "optimised",
      "optimised",
    ]);
    expect(result.totals).toEqual({
      files: 4,
      optimised: 3,
      keptOriginal: 0,
      skipped: 0,
      failed: 1,
      inputBytes: optimised.reduce((sum, file) => sum + (file.bytes ?? 0), 0),
      outputBytes: optimised.reduce(
        (sum, file) => sum + (file.outputs[0]?.bytes ?? 0),
        0
      ),
      saving: expect.any(Number) as number,
    });

    expect(events[0]).toMatchObject({ type: "run-start", files: 4 });
    expect(events.at(-1)).toEqual({ type: "run-done", totals: result.totals });
    expect(events.slice(1, 3).map((event) => event.type)).toEqual([
      "file-start",
      "file-start",
    ]); // two lanes start before either finishes
    for (const [index, file] of result.files.entries()) {
      const start = events.findIndex(
        (event) => event.type === "file-start" && event.index === index
      );
      const done = events.findIndex(
        (event) => event.type === "file-done" && event.index === index
      );

      expect(start).toBeGreaterThan(0);
      expect(done).toBeGreaterThan(start);
      expect(events[done]).toEqual({ type: "file-done", index, file });
    }
    expect(events).toHaveLength(2 + 2 * inputs.length);
  });

  it("fails a later input whose outputs would land on an earlier one's", async () => {
    const [png = "", jpeg = ""] = await copyFixtures([
      ["gradient-16bit.png", "scene.png"],
      ["display-p3.jpg", "scene.jpg"],
    ]);
    const outDir = path.join(folder, "out");
    const converted = await optimiseBatch([png, jpeg], { outDir });

    expect(converted.files[0]?.status).toBe("optimised");
    expect(converted.files[1]).toMatchObject({
      input: jpeg,
      status: "failed",
      error: {
        code: "E_OUTPUT_CONFLICT",
        message: expect.stringContaining(png) as string,
      },
    });
    expect(await listFiles(outDir)).toEqual(["scene.webp"]);

    const same = await optimiseBatch([png, jpeg], { to: "same", outDir });

    expect(same.files.map((file) => file.status)).toEqual([
      "optimised",
      "kept-original",
    ]); // same mode keeps each input's own name, so these don't clash
  });

  it("judges clashes by the formats in the files' bytes", async () => {
    const [misnamed = "", png = ""] = await copyFixtures([
      ["gradient-16bit.png", "photo.jpg"], // a png named .jpg writes photo.png
      ["gradient.png", "photo.png"],
    ]);
    const result = await optimiseBatch([misnamed, png], {
      to: "same",
      outDir: path.join(folder, "out"),
    });

    expect(result.files[0]?.status).toBe("optimised");
    expect(result.files[1]).toMatchObject({
      status: "failed",
      error: {
        code: "E_OUTPUT_CONFLICT",
        message: expect.stringContaining(misnamed) as string,
      },
    });
  });

  it("fails an input whose output would replace another input", async () => {
    const [png = "", webp = ""] = await copyFixtures([
      ["gradient-16bit.png", "scene.png"],
      ["lossless.webp", "out/scene.webp"],
    ]);
    const result = await optimiseBatch([webp, png], {
      outDir: path.dirname(webp),
      overwrite: true, // without the conflict check, the png's webp would replace the other input
    });

    expect(result.files.map((file) => file.error?.code)).toEqual([
      "E_OUTPUT_IS_INPUT",
      "E_OUTPUT_CONFLICT",
    ]);
    expect(result.files[1]?.error?.message).toContain(webp);
    expect(await readFile(webp)).toEqual(
      await readFile(fixturePath("lossless.webp"))
    );
  });

  it("fails the same file given twice", async () => {
    const [input = ""] = await copyFixtures([["icon-6x6.png", "icon.png"]]);
    const result = await optimiseBatch([input, input], {
      outDir: path.join(folder, "out"),
    });

    expect(result.files.map((file) => file.error?.code)).toEqual([
      undefined,
      "E_OUTPUT_CONFLICT",
    ]);
  });

  it("writes each input to its own output folder when given one", async () => {
    const [first = "", second = ""] = await copyFixtures([
      ["gradient-16bit.png", "a/scene.png"],
      ["gradient-16bit.png", "b/scene.png"],
    ]);
    const outDir = path.join(folder, "out");
    const result = await optimiseBatch([
      { path: first, outDir: path.join(outDir, "a") },
      { path: second, outDir: path.join(outDir, "b") },
    ]);

    expect(result.files.map((file) => file.status)).toEqual([
      "optimised",
      "optimised",
    ]);
    expect(await listFiles(outDir)).toEqual([
      "a",
      path.join("a", "scene.webp"),
      "b",
      path.join("b", "scene.webp"),
    ]);
  });

  it("returns an empty run for no inputs", async () => {
    const events: PipelineEvent[] = [];
    const result = await optimiseBatch(
      [],
      {},
      { onEvent: (event) => events.push(event) }
    );

    expect(result.files).toEqual([]);
    expect(result.totals).toMatchObject({ files: 0, inputBytes: 0, saving: 0 });
    expect(events.map((event) => event.type)).toEqual([
      "run-start",
      "run-done",
    ]);
  });

  it("rejects an invalid concurrency or option before any event", async () => {
    const events: PipelineEvent[] = [];
    const onEvent = (event: PipelineEvent) => events.push(event);

    await expect(
      optimiseBatch([], {}, { concurrency: 0, onEvent })
    ).rejects.toThrow(RangeError);
    await expect(
      optimiseBatch([], {}, { concurrency: 1.5, onEvent })
    ).rejects.toThrow(RangeError);
    await expect(
      optimiseBatch([], { target: -1 }, { onEvent })
    ).rejects.toThrow(RangeError);
    expect(events).toEqual([]);
  });

  it("rejects straight away when already aborted", async () => {
    const events: PipelineEvent[] = [];
    const signal = AbortSignal.abort();
    const run = optimiseBatch(
      [fixturePath("gradient.png")],
      {},
      {
        signal,
        onEvent: (event) => events.push(event),
      }
    );

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(events).toEqual([]);
  });

  it("rejects once aborted, after every file in progress has stopped, leaving no temp files", async () => {
    const inputs = await copyFixtures([
      ["screenshot.png", "screenshot.png"],
      ["text-chunks.png", "text-chunks.png"],
      ["semi-transparent.png", "semi-transparent.png"],
    ]);
    const outDir = path.join(folder, "out");
    const controller = new AbortController();
    const events: PipelineEvent[] = [];
    const run = optimiseBatch(
      inputs,
      { to: "suite", outDir },
      {
        concurrency: 2,
        signal: controller.signal,
        onEvent: (event) => events.push(event),
      }
    );

    setTimeout(() => controller.abort(), 300);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(events.map((event) => event.type)).not.toContain("run-done");
    expect(
      (await listFiles(outDir)).filter((name) => name.endsWith(".tmp"))
    ).toEqual([]);
  });

  it("stops the run when onEvent throws", async () => {
    const inputs = await copyFixtures([
      ["icon-6x6.png", "one.png"],
      ["icon-6x6.png", "two.png"],
    ]);
    const failure = new Error("listener failed");
    const run = optimiseBatch(
      inputs,
      { outDir: path.join(folder, "out") },
      {
        concurrency: 1,
        onEvent: (event) => {
          if (event.type === "file-done") {
            throw failure;
          }
        },
      }
    );

    await expect(run).rejects.toBe(failure);
  });
});
