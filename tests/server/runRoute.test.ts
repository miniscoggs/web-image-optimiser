import { copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventSchema } from "../../src/schema/contract.js";
import { apiErrorSchema, cliEventSchema } from "../../src/server/api.js";
import { fixturePath } from "../fixtureManifest.js";
import { readEvents, readRun, startUiSession } from "./uiSession.js";
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
    const messages = events.filter((event) => event.name === "message");
    const parsed = messages.map((event) => eventSchema.parse(event.data));
    const done = parsed.flatMap((event) =>
      event.type === "file-done" ? [event.file] : []
    );
    const outputs = done.flatMap((file) => file.outputs);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(
      events.every((event) => ["message", "cli"].includes(event.name))
    ).toBe(true);
    expect(parsed).toEqual(messages.map((event) => event.data)); // parsing keeps every field
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
    expect(
      events
        .filter((event) => event.name === "cli")
        .map((event) => cliEventSchema.parse(event.data))
        .toSorted((first, second) => first.index - second.index)
    ).toEqual([
      { index: 0, reason: "input", ref: "root/logo-alpha.png" }, // its png fallback, known once chosen
      { index: 1, reason: "input", ref: "root/title-viewbox.svg" }, // an svg stays svg, known before any work
    ]);
    for (const output of outputs) {
      expect(output.path).toMatch(/^session\/runs\/\d+\/[01]\/[\w-]+\.\w+$/);
      expect((await session.image(output.path)).status).toBe(200);
    }
    expect(await readdir(session.outside, { recursive: true })).toEqual(before);
  });

  it("names files by ref in its messages", async () => {
    const response = await session.post("/api/optimise", {
      files: ["root/title-viewbox.svg", "root/title-viewbox.svg"],
    });
    const { events } = await readRun(response);
    const failed = events.find(
      (event) => event.type === "file-done" && event.index === 1
    );

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
    const { events } = await readRun(response);
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

  it("flags files the copied command would fail for replacing their input, a kept-original one too", async () => {
    const sameSession = await startUiSession([
      "display-p3.jpg",
      "icon-6x6.png",
    ]);

    try {
      const response = await sameSession.post("/api/optimise", {
        files: ["root/display-p3.jpg", "root/icon-6x6.png"],
        to: "same",
      });
      const { events, cli } = await readRun(response);
      const statuses = events.flatMap((event) =>
        event.type === "file-done" ? [[event.index, event.file.status]] : []
      );

      expect(statuses.toSorted()).toEqual([
        [0, "kept-original"], // the command refuses it before any work
        [1, "optimised"],
      ]);
      expect(
        cli.toSorted((first, second) => first.index - second.index)
      ).toEqual([
        { index: 0, reason: "input", ref: "root/display-p3.jpg" },
        { index: 1, reason: "input", ref: "root/icon-6x6.png" },
      ]);
    } finally {
      await sameSession.close();
    }
  });

  it("flags a file whose output already exists where the command writes it", async () => {
    await copyFile(
      fixturePath("icon-6x6.png"),
      path.join(session.root, "taken.png")
    );
    await copyFile(
      fixturePath("lossy.webp"),
      path.join(session.root, "taken.webp")
    );

    const response = await session.post("/api/optimise", {
      files: ["root/taken.png"],
      to: "webp",
    });
    const { events, cli } = await readRun(response);

    expect(events.at(-1)).toMatchObject({
      type: "run-done",
      totals: { optimised: 1 },
    });
    expect(cli).toEqual([
      { index: 0, reason: "exists", ref: "root/taken.webp" },
    ]);
  });

  it("sends no cli events when the command would write what the run did", async () => {
    const response = await session.post("/api/optimise", {
      files: ["root/logo-alpha.png"],
      to: "webp",
    });
    const { events, cli } = await readRun(response);

    expect(events.at(-1)).toMatchObject({
      type: "run-done",
      totals: { optimised: 1 },
    });
    expect(cli).toEqual([]);
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
    const { events } = await readRun(response);
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
