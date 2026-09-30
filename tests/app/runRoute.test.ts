import { chmod, copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiErrorSchema } from "../../src/app/api.js";
import { DEFAULT_LANGUAGE, readRights } from "../../src/rights/index.js";
import { eventSchema } from "../../src/schema/contract.js";
import { fixturePath } from "../fixtureManifest.js";
import { readEvents, readRun, startAppSession } from "./appSession.js";
import type { AppSession } from "./appSession.js";

let session: AppSession;

beforeAll(async () => {
  session = await startAppSession([
    "logo-alpha.png",
    "title-viewbox.svg",
    "screenshot.png",
    "gradient-16bit.png",
  ]);
});
afterAll(async () => {
  await session.close();
});

/**
 * Runs opened files, and returns the files' results.
 *
 * @param body - The request.
 */
async function runFiles(body: Record<string, unknown>) {
  const events = await readRun(await session.post("/api/optimise", body));

  return events.flatMap((event) =>
    event.type === "file-done" ? [event.file] : []
  );
}

describe("POST /api/optimise", () => {
  it("streams a suite run's events with refs, writing only into the session folder", async () => {
    const before = await readdir(session.outside, { recursive: true });
    const files = [
      session.ref("logo-alpha.png"),
      session.ref("title-viewbox.svg"),
    ];
    const response = await session.post("/api/optimise", {
      files,
      target: "excellent",
    });
    const events = await readEvents(response);
    const parsed = events.map((event) => eventSchema.parse(event.data));
    const done = parsed.flatMap((event) =>
      event.type === "file-done" ? [event.file] : []
    );
    const outputs = done.flatMap((file) => file.outputs);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(events.every((event) => event.name === "message")).toBe(true);
    expect(parsed).toEqual(events.map((event) => event.data)); // parsing keeps every field
    expect(parsed[0]).toMatchObject({
      type: "run-start",
      files: 2,
      options: { to: "suite", target: 85, dryRun: false, inPlace: false },
    });
    expect(parsed.at(-1)).toMatchObject({ type: "run-done" });
    expect(done.map((file) => file.input).toSorted()).toEqual(files.toSorted());
    expect(outputs.length).toBeGreaterThan(1);
    for (const output of outputs) {
      expect(output.path).toMatch(/^session\/runs\/\d+\/[01]\/[\w-]+\.\w+$/);
      expect((await session.image(output.path)).status).toBe(200);
    }
    expect(await readdir(session.outside, { recursive: true })).toEqual(before);
  });

  it("runs a file given twice into a folder each", async () => {
    const ref = session.ref("title-viewbox.svg");
    const done = await runFiles({ files: [ref, ref], target: "web" });

    expect(done.map((file) => file.status)).toEqual(["optimised", "optimised"]);
    expect(
      done
        .flatMap((file) => file.outputs.map((output) => output.path))
        .toSorted()
    ).toEqual([
      expect.stringMatching(/^session\/runs\/\d+\/0\/title-viewbox\.svg$/),
      expect.stringMatching(/^session\/runs\/\d+\/1\/title-viewbox\.svg$/),
    ]);
  });

  it("shrinks to the maximum width, and adds the rights fields given", async () => {
    const [file] = await runFiles({
      files: [session.ref("gradient-16bit.png")],
      target: "web",
      maxWidth: 100,
      rights: { copyright: " © Example " },
    });
    const outputs = file?.outputs ?? [];

    expect(outputs.length).toBeGreaterThan(0);
    for (const { format, ...output } of outputs) {
      const bytes = await session.bytesOf(output.path);

      if (format === "svg") {
        throw new Error("A PNG's outputs are raster images");
      }
      expect(output).toMatchObject({
        width: 100,
        height: 75,
        rightsAdded: ["copyright"],
      });
      expect((await sharp(bytes).metadata()).width).toBe(100);
      expect(readRights(bytes, format)).toEqual({
        copyright: [{ lang: DEFAULT_LANGUAGE, value: "© Example" }],
      });
    }
  });

  it.skipIf(process.platform === "win32")(
    "names files by ref in its messages",
    async () => {
      const locked = path.join(session.folder, "locked.png");

      await copyFile(fixturePath("icon-6x6.png"), locked);

      const [ref = ""] = await session.open(locked);

      await chmod(locked, 0o000); // readable by its path, but not its bytes

      const [failed] = await runFiles({ files: [ref], target: "web" });

      expect(failed).toMatchObject({
        input: ref,
        status: "failed",
        error: { code: "E_READ" },
      });
      expect(failed?.error?.message).toMatch(
        /^The file could not be read: .*'file\/\d+\/locked\.png'$/
      );
    }
  );

  it("stops the run in progress when a new one starts", async () => {
    const first = await session.post("/api/optimise", {
      files: [session.ref("screenshot.png")],
      target: "web",
    });
    const second = await session.post("/api/optimise", {
      files: [session.ref("title-viewbox.svg")],
      target: "web",
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await readEvents(first)).at(-1)?.data).not.toMatchObject({
      type: "run-done",
    });
    expect((await readEvents(second)).at(-1)?.data).toMatchObject({
      type: "run-done",
    });
  });

  it("refuses a JSON body sent as another type with 415", async () => {
    const response = await session.api("/api/optimise", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ files: [session.ref("logo-alpha.png")] }),
    });

    expect(response.status).toBe(415);
  });

  it.each([
    ["no files", { files: [] }],
    ["no target", { target: undefined }],
    ["a target over 100", { target: 101 }],
    ["an unknown preset", { target: "best" }],
    ["a maximum width of 0", { maxWidth: 0 }],
    ["an empty rights field", { rights: { creator: " " } }],
    [
      "a rights URL that isn't a web address",
      { rights: { rightsUrl: "ftp://a" } },
    ],
    [
      "stripAll with rights fields",
      { stripAll: true, rights: { credit: "A" } },
    ],
    ["a body that isn't JSON", "files"],
    ["a ref in the session folder", { files: ["session/runs/1/0/a.png"] }],
    ["a ref out of the session folder", { files: ["session/../secret.png"] }],
  ])("refuses %s with 400", async (_name, change) => {
    const response = await session.post(
      "/api/optimise",
      typeof change === "string"
        ? change
        : { files: [session.ref("logo-alpha.png")], target: "web", ...change }
    );

    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error).toMatch(
      /^(The request isn't valid|Not a file reference)/
    );
  });

  it("fails a file that wasn't opened with E_READ, as the CLI fails a missing one, and runs the rest", async () => {
    const events = await readRun(
      await session.post("/api/optimise", {
        files: ["file/99/missing.png", session.ref("title-viewbox.svg")],
        target: "web",
      })
    );
    const done = events.flatMap((event) =>
      event.type === "file-done" ? [event] : []
    );

    expect(done.find((event) => event.index === 0)?.file).toMatchObject({
      input: "file/99/missing.png",
      status: "failed",
      error: { code: "E_READ", message: "No such image: file/99/missing.png" },
    });
    expect(done.find((event) => event.index === 1)?.file.status).toBe(
      "optimised"
    );
    expect(events.at(-1)).toMatchObject({
      type: "run-done",
      totals: { files: 2, failed: 1 },
    });
  });
});
