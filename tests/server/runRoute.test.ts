import { copyFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventSchema } from "../../src/schema/contract.js";
import { apiErrorSchema, uploadResponseSchema } from "../../src/server/api.js";
import { fixturePath } from "../fixtureManifest.js";
import { readEvents, startUiSession } from "./uiSession.js";
import type { UiSession } from "./uiSession.js";

let session: UiSession;

beforeAll(async () => {
  session = await startUiSession([
    "logo-alpha.png",
    "title-viewbox.svg",
    "screenshot.png",
  ]);
});
afterAll(async () => {
  await session.close();
});

describe("POST /api/optimise", () => {
  it("streams the run's events with refs, writing only into the session folder", async () => {
    const before = await readdir(session.outside, { recursive: true });
    const response = await session.post("/api/optimise", {
      files: ["root/logo-alpha.png", "root/title-viewbox.svg"],
      to: "suite",
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
    expect(done.map((file) => file.input).toSorted()).toEqual([
      "root/logo-alpha.png",
      "root/title-viewbox.svg",
    ]);
    expect(outputs.length).toBeGreaterThan(1);
    for (const output of outputs) {
      expect(output.path).toMatch(/^session\/runs\/\d+\/[01]\/[\w-]+\.\w+$/);
      expect((await session.image(output.path)).status).toBe(200);
    }
    expect(await readdir(session.outside, { recursive: true })).toEqual(before);
  });

  it("adds the markup a suite run would print, with each output beside its input", async () => {
    const markupSession = await startUiSession(["photos/logo-alpha.png"]);
    const form = new FormData();
    const bytes = await readFile(fixturePath("icon-6x6.png"));

    form.append("file", new Blob([bytes]), "icon.png");
    try {
      const upload = await markupSession.api("/api/upload", {
        method: "POST",
        body: form,
      });
      const [uploaded] = uploadResponseSchema.parse(await upload.json()).files;
      const run = async (to: string) => {
        const response = await markupSession.post("/api/optimise", {
          files: ["root/photos/logo-alpha.png", uploaded?.ref],
          to,
        });
        const events = await readEvents(response);

        return events
          .map((event) => eventSchema.parse(event.data))
          .flatMap((event) => (event.type === "file-done" ? [event] : []))
          .toSorted((first, second) => first.index - second.index)
          .map((event) => event.file);
      };
      const urlsOf = (markup: string | undefined) =>
        [...(markup ?? "").matchAll(/(?:src|srcset)="([^"]+)"/g)].map(
          (match) => match[1]
        );
      const [photo, icon] = await run("suite");
      const namesOf = (file: typeof photo) =>
        file?.outputs.map((output) => path.posix.basename(output.path));

      expect(photo?.outputs.length).toBeGreaterThan(1);
      expect(urlsOf(photo?.markup)).toEqual(
        namesOf(photo)?.map((name) => `photos/${name}`)
      );
      expect(photo?.markup).toMatch(/^<picture>/);
      expect(urlsOf(icon?.markup)).toEqual(namesOf(icon));
      expect(
        (await run("webp")).map((file) => file.markup === undefined)
      ).toEqual([true, true]);
    } finally {
      await markupSession.close();
    }
  });

  it("names files by ref in its messages", async () => {
    const response = await session.post("/api/optimise", {
      files: ["root/title-viewbox.svg", "root/title-viewbox.svg"],
    });
    const events = await readEvents(response);
    const failed = events
      .map((event) => eventSchema.parse(event.data))
      .find((event) => event.type === "file-done" && event.index === 1);

    expect(failed).toMatchObject({
      file: {
        input: "root/title-viewbox.svg",
        status: "failed",
        error: {
          code: "E_OUTPUT_CONFLICT",
          message:
            "It is the same file as an earlier input, root/title-viewbox.svg",
        },
      },
    });
  });

  it("fails files whose outputs would clash beside their inputs, as the CLI does", async () => {
    await copyFile(
      fixturePath("icon-6x6.png"),
      path.join(session.root, "clash.png")
    );
    await copyFile(
      fixturePath("display-p3.jpg"),
      path.join(session.root, "clash.jpg")
    );

    const response = await session.post("/api/optimise", {
      files: ["root/clash.png", "root/clash.jpg"],
      to: "webp",
    });
    const events = (await readEvents(response)).map((event) =>
      eventSchema.parse(event.data)
    );
    const done = events.flatMap((event) =>
      event.type === "file-done" ? [event] : []
    );

    expect(events[0]).toMatchObject({ type: "run-start", files: 2 });
    expect(done.map((event) => [event.index, event.file.status])).toEqual(
      expect.arrayContaining([
        [0, "optimised"],
        [1, "failed"],
      ])
    );
    expect(done.find((event) => event.index === 1)?.file.error).toEqual({
      code: "E_OUTPUT_CONFLICT",
      message: "Its outputs would land on those of root/clash.png",
    });
    expect(events.at(-1)).toMatchObject({
      type: "run-done",
      totals: { files: 2, optimised: 1, failed: 1 },
    });
  });

  it("stops the run in progress when a new one starts", async () => {
    const first = await session.post("/api/optimise", {
      files: ["root/screenshot.png"],
      to: "avif",
    });
    const second = await session.post("/api/optimise", {
      files: ["root/title-viewbox.svg"],
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
      body: JSON.stringify({ files: ["root/logo-alpha.png"] }),
    });

    expect(response.status).toBe(415);
  });

  it.each([
    ["no files", { files: [] }],
    ["an unknown mode", { files: ["root/logo-alpha.png"], to: "gif" }],
    ["a target over 100", { files: ["root/logo-alpha.png"], target: 101 }],
    ["an unknown preset", { files: ["root/logo-alpha.png"], target: "best" }],
    ["a body that isn't JSON", "files"],
    ["a ref out of the root", { files: ["root/../secret.png"] }],
  ])("refuses %s with 400", async (_name, body) => {
    const response = await session.post("/api/optimise", body);

    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error).toMatch(
      /^(The request isn't valid|Not a file reference)/
    );
  });

  it("fails a file that has gone with E_READ, as the CLI does, and runs the rest", async () => {
    const response = await session.post("/api/optimise", {
      files: ["root/missing.png", "root/title-viewbox.svg"],
    });
    const events = (await readEvents(response)).map((event) =>
      eventSchema.parse(event.data)
    );
    const done = events.flatMap((event) =>
      event.type === "file-done" ? [event] : []
    );

    expect(response.status).toBe(200);
    expect(done.find((event) => event.index === 0)?.file).toMatchObject({
      input: "root/missing.png",
      status: "failed",
      error: { code: "E_READ", message: "No such image: root/missing.png" },
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
