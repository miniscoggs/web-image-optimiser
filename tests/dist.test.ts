import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PipelineEvent } from "../src/pipeline/index.js";
import { eventSchema, runResultSchema } from "../src/schema/contract.js";
import { diffResponseSchema, searchResponseSchema } from "../src/app/api.js";
import { fixturePath } from "./fixtureManifest.js";

type App = typeof import("../src/app/index.js");
type Metrics = typeof import("../src/metrics/index.js");
type Pipeline = typeof import("../src/pipeline/index.js");

const DIST_DIR = new URL("../dist/", import.meta.url);
const RENDERER_DIR = new URL("../desktop/build/renderer/", import.meta.url);
const PAIR_DIR = new URL("../fixtures/ssimulacra2/", import.meta.url);

/**
 * Imports a module from the build.
 *
 * @param name - The module's folder under `src/`, eg `pipeline`.
 */
async function importBuilt<T>(name: string) {
  return (await import(new URL(`${name}/index.js`, DIST_DIR).href)) as T;
}

/**
 * Copies fixtures into a new temp folder.
 *
 * @param files - The fixtures' file names.
 */
async function copyToTemp(files: string[]) {
  const folder = await mkdtemp(path.join(tmpdir(), "wio-dist-"));
  const inputs = [];

  for (const file of files) {
    const target = path.join(folder, file);

    await copyFile(fixturePath(file), target);
    inputs.push(target);
  }
  return { folder, inputs };
}

// dist exists only after `npm run build`, which CI runs before the tests
describe.skipIf(!existsSync(DIST_DIR))("build", () => {
  it("scores through the wasm copied into dist/wasm", async () => {
    const metrics = await importBuilt<Metrics>("metrics");
    const reference = await metrics.decodeForScoring(
      fileURLToPath(new URL("butterfly.png", PAIR_DIR))
    );
    const distorted = await metrics.decodeForScoring(
      fileURLToPath(new URL("butterfly-q60.webp", PAIR_DIR))
    );

    await expect(metrics.score(reference, distorted)).resolves.toBeCloseTo(
      68.08, // libjxl's reference score for this pair
      0
    );
  });

  it("optimises a batch in child processes", async () => {
    const pipeline = await importBuilt<Pipeline>("pipeline");
    const { folder, inputs } = await copyToTemp([
      "gradient-16bit.png",
      "icon-6x6.png",
      "title-viewbox.svg",
    ]);
    const events: PipelineEvent[] = [];

    try {
      const result = await pipeline.optimiseBatch(
        inputs,
        { outDir: path.join(folder, "out") },
        { concurrency: 2, onEvent: (event) => events.push(event) }
      );

      expect(runResultSchema.parse(result)).toEqual(result);
      for (const event of events) {
        expect(eventSchema.parse(event)).toEqual(event);
      }
      expect(result.files.map((file) => file.status)).toEqual([
        "optimised",
        "optimised",
        "optimised",
      ]);
      expect(events.map((event) => event.type).slice(0, 3)).toEqual([
        "run-start",
        "file-start",
        "file-start",
      ]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("leaves no temp files when a batch in child processes is aborted", async () => {
    const pipeline = await importBuilt<Pipeline>("pipeline");
    const { folder, inputs } = await copyToTemp([
      "screenshot.png",
      "text-chunks.png",
    ]);
    const outDir = path.join(folder, "out");
    const controller = new AbortController();

    try {
      const run = pipeline.optimiseBatch(
        inputs,
        { to: "suite", outDir },
        { concurrency: 2, signal: controller.signal }
      );

      setTimeout(() => controller.abort(), 500);
      await expect(run).rejects.toMatchObject({ name: "AbortError" });
      expect(await readdir(folder)).toEqual(
        inputs.map((input) => path.basename(input))
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("makes the app's searches and diff maps in its pixel process", async () => {
    const { createAppApi } = await importBuilt<App>("app");
    const { folder, inputs } = await copyToTemp(["gradient-16bit.png"]);
    const app = await createAppApi();

    try {
      const post = (pathname: string, body: unknown) =>
        app.handle(
          new Request(new URL(pathname, "wio://app/"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        );
      const [opened] = await app.open(inputs);
      const file = opened !== undefined && "ref" in opened ? opened.ref : "";
      const found = searchResponseSchema.parse(
        await (
          await post("/api/search", { file, format: "avif", target: "web" })
        ).json()
      );
      const diff = await post("/api/diff", {
        original: file,
        candidate: found.ref,
      });

      expect(found).toMatchObject({ format: "avif", reached: true });
      expect(diffResponseSchema.parse(await diff.json()).ref).toMatch(
        /^session\/diffs\//
      );
    } finally {
      await app.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});

// the renderer exists only after vite builds the ui
describe.skipIf(!existsSync(RENDERER_DIR))("renderer build", () => {
  it("bundles no zod, SVGO or sharp", async () => {
    const assets = new URL("assets/", RENDERER_DIR);
    const scripts = (await readdir(assets)).filter(
      (name) => path.extname(name) === ".js"
    );
    const bodies = await Promise.all(
      scripts.map((name) => readFile(new URL(name, assets), "utf8"))
    );

    expect(scripts).not.toEqual([]);
    expect(bodies.join("\n")).not.toMatch(/ZodError|preset-default|libvips/); // strings zod, svgo and sharp each hold
  });
});
