import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PipelineEvent } from "../src/pipeline/index.js";
import { eventSchema, runResultSchema } from "../src/schema/contract.js";
import { diffResponseSchema, encodeResponseSchema } from "../src/server/api.js";
import { fixturePath } from "./fixtureManifest.js";

type Metrics = typeof import("../src/metrics/index.js");
type Pipeline = typeof import("../src/pipeline/index.js");
type Server = typeof import("../src/server/index.js");

const DIST_DIR = new URL("../dist/", import.meta.url);
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

  it("serves the UI's re-encodes and diff maps from its pixel process", async () => {
    const { startUiServer } = await importBuilt<Server>("server");
    const { folder } = await copyToTemp(["gradient-16bit.png"]);
    const server = await startUiServer({ root: folder });

    try {
      const exchange = await fetch(server.url, { redirect: "manual" });
      const cookie = exchange.headers.get("set-cookie")?.split(";")[0] ?? "";
      const post = (pathname: string, body: unknown) =>
        fetch(new URL(pathname, server.url), {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const encoded = encodeResponseSchema.parse(
        await (
          await post("/api/encode", {
            file: "root/gradient-16bit.png",
            format: "avif",
            quality: 80, // a gradient bands badly below this
          })
        ).json()
      );
      const diff = await post("/api/diff", {
        original: "root/gradient-16bit.png",
        candidate: encoded.ref,
      });

      expect(encoded.score).toBeGreaterThan(50);
      expect(diffResponseSchema.parse(await diff.json()).ref).toMatch(
        /^session\/diffs\//
      );
    } finally {
      await server.close();
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("serves the built UI, whose scripts are all files the page policy allows", async () => {
    const { startUiServer } = await importBuilt<Server>("server");
    const { folder } = await copyToTemp([]);
    const server = await startUiServer({ root: folder });

    try {
      const exchange = await fetch(server.url, { redirect: "manual" });
      const cookie = exchange.headers.get("set-cookie")?.split(";")[0] ?? "";
      const get = (pathname: string) =>
        fetch(new URL(pathname, server.url), { headers: { cookie } });
      const page = await get("/");
      const html = await page.text();
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)];

      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toMatch(/^text\/html/);
      expect(page.headers.get("content-security-policy")).toMatch(
        /default-src 'self'/
      );
      expect(html.match(/<script\b[^>]*>/g)).toEqual([
        expect.stringMatching(/ src="\/assets\/[\w-]+\.js"/),
      ]);
      expect(assets.map((match) => path.extname(match[1] ?? ""))).toEqual([
        ".js",
        ".css",
      ]);
      const bodies = await Promise.all(
        assets.map(async ([, asset]) => {
          const response = await get(asset ?? "");

          expect(response.status).toBe(200);
          return response.text();
        })
      );

      expect(bodies.join("\n")).not.toMatch(/ZodError|preset-default|libvips/); // strings zod, svgo and sharp each hold, so none of them is bundled
    } finally {
      await server.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
