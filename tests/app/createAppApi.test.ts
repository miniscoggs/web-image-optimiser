import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { glob } from "tinyglobby";
import { afterEach, describe, expect, it } from "vitest";
import { apiErrorSchema } from "../../src/app/api.js";
import { fixturePath } from "../fixtureManifest.js";
import { startAppSession } from "./appSession.js";
import type { AppSession } from "./appSession.js";

let session: AppSession | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
});

/**
 * Searches a copy of a fixture with a unique name, and returns the API's temp folder, found by
 * that name, since the API gives out refs rather than paths.
 *
 * @param app - The session.
 */
async function findSessionFolder(app: AppSession) {
  const name = `probe-${randomUUID()}`;
  const probe = path.join(app.folder, `${name}.png`);

  await copyFile(fixturePath("icon-6x6.png"), probe);

  const [ref] = await app.open(probe);

  await app.post("/api/search", { file: ref, format: "png", target: "web" });

  const [match] = await glob(`.wio-app-*/searches/*/${name}.png`, {
    cwd: tmpdir(),
    dot: true,
  });

  return path.join(tmpdir(), match?.split("/")[0] ?? "missing");
}

describe("createAppApi", () => {
  it("sends hardening headers", async () => {
    session = await startAppSession(["gradient.png"]);

    const response = await session.image(session.ref("gradient.png"));

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toBe("sandbox"); // an image's own
    expect(
      (await session.api("/api/nothing")).headers.get("content-security-policy")
    ).toContain("frame-ancestors 'none'");
  });

  it.each([
    ["an unknown endpoint", "/api/nothing"],
    ["a page", "/"],
    ["the removed re-encode", "/api/encode"],
  ])("answers %s with 404", async (_name, pathname) => {
    session = await startAppSession([]);

    const response = await session.api(pathname, { method: "POST" });

    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(await response.json()).error).toBe(
      "No such endpoint"
    );
  });

  it("removes its temp folder on close, once however often it's called, and refuses requests and calls after", async () => {
    const app = await startAppSession(["logo-alpha.png"]);

    session = app;
    const folder = await findSessionFolder(app);

    expect(existsSync(folder)).toBe(true);
    await Promise.all([app.app.close(), app.app.close()]);
    expect(existsSync(folder)).toBe(false);

    const after = await app.image(app.ref("logo-alpha.png"));

    expect(after.status).toBe(503);
    expect(apiErrorSchema.parse(await after.json()).error).toBe(
      "The app is closing"
    );
    await expect(app.app.open([app.secret])).rejects.toThrow(
      "The app is closing"
    );
    await expect(
      app.app.saveSuites(
        [{ original: app.ref("logo-alpha.png"), candidates: [] }],
        app.outside
      )
    ).rejects.toThrow("The app is closing");
  });

  it("stops a run in progress on close", async () => {
    session = await startAppSession(["screenshot.png"]);

    const response = await session.post("/api/optimise", {
      files: [session.ref("screenshot.png")],
      target: "web",
    });
    const reader = (
      response.body as ReadableStream<Uint8Array> | null
    )?.getReader();
    const decoder = new TextDecoder();
    const first = await reader?.read(); // run-start, so the run is under way
    let text = decoder.decode(first?.value);
    const closing = session.app.close();

    for (
      let chunk = await reader?.read();
      chunk?.done === false;
      chunk = await reader?.read()
    ) {
      text += decoder.decode(chunk.value);
    }
    await closing;
    expect(response.status).toBe(200);
    expect(text).toContain("run-start");
    expect(text).not.toContain("run-done");
  });

  it("leaves no temp folder with searches under way", async () => {
    const app = await startAppSession(["gradient-16bit.png"]);

    session = app;
    const folder = await findSessionFolder(app);
    const searches = [70, 80].map((target) =>
      app.post("/api/search", {
        file: app.ref("gradient-16bit.png"),
        format: "avif",
        target,
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 150)); // so they reach the pixel runner
    await app.app.close();
    await Promise.all(searches);
    expect(existsSync(folder)).toBe(false);
  });
});
