import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startUiServer } from "../../src/server/index.js";
import { fixturePath } from "../fixtureManifest.js";
import { findSessionFolder, startUiSession } from "./uiSession.js";
import type { UiSession } from "./uiSession.js";

let session: UiSession | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe("startUiServer", () => {
  it("stops listening and removes its temp folder on close, once however often it's called", async () => {
    session = await startUiSession(["logo-alpha.png"]);

    const folder = await findSessionFolder(session.api);

    expect(existsSync(folder)).toBe(true);
    await Promise.all([session.server.close(), session.server.close()]);
    expect(existsSync(folder)).toBe(false);
    await expect(session.api("/api/files")).rejects.toThrow();
  });

  it("writes a page only its user can read that forwards to its address, and removes it on close", async () => {
    session = await startUiSession([]);

    const { openFile, url } = session.server;

    expect(await readFile(openFile, "utf8")).toContain(
      `<meta http-equiv="refresh" content="0; url=${url}">`
    );
    if (process.platform !== "win32") {
      expect((await stat(openFile)).mode & 0o077).toBe(0); // nobody else can read the token
    }
    await session.server.close();
    expect(existsSync(openFile)).toBe(false);
  });

  it("stops a run in progress on close", async () => {
    session = await startUiSession(["screenshot.png"]);

    const response = await session.post("/api/optimise", {
      files: ["root/screenshot.png"],
      to: "suite",
    });

    const reader = (
      response.body as ReadableStream<Uint8Array> | null
    )?.getReader();
    const decoder = new TextDecoder();
    const first = await reader?.read(); // run-start, so the run is under way
    let text = decoder.decode(first?.value);
    const closing = session.server.close();

    try {
      for (
        let chunk = await reader?.read();
        chunk?.done === false;
        chunk = await reader?.read()
      ) {
        text += decoder.decode(chunk.value);
      }
    } catch {
      // closing cuts the connection
    }
    await closing;
    expect(response.status).toBe(200);
    expect(text).toContain("run-start");
    expect(text).not.toContain("run-done");
  });

  it("refuses requests while it stops, and leaves no temp folder with re-encodes under way", async () => {
    const ui = await startUiSession(["gradient-16bit.png"]);

    session = ui;
    const folder = await findSessionFolder(ui.api);
    const encodes = [50, 60].map((quality) =>
      ui.post("/api/encode", {
        file: "root/gradient-16bit.png",
        format: "avif",
        quality,
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 150)); // so they reach the server

    const closing = ui.server.close();
    const during = await ui.api("/api/files").catch(() => undefined); // refused, or no connection

    await closing;
    await Promise.allSettled(encodes);
    expect(during?.status ?? 503).toBe(503);
    expect(existsSync(folder)).toBe(false);
  });

  it("rejects a root that isn't a folder", async () => {
    await expect(
      startUiServer({ root: fixturePath("logo-alpha.png") })
    ).rejects.toThrow("is not a folder");
    await expect(
      startUiServer({ root: path.join(tmpdir(), `missing-${randomUUID()}`) })
    ).rejects.toThrow("is not a folder");
  });

  it("rejects a port in use", async () => {
    session = await startUiSession([]);

    await expect(
      startUiServer({ root: session.root, port: Number(session.url.port) })
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});
