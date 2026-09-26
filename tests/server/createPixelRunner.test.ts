import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import createPixelRunner from "../../src/server/createPixelRunner.js";
import { fixturePath } from "../fixtureManifest.js";

let folder = "";

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("createPixelRunner", () => {
  it("finishes the job under way on close, and fails the queued ones without starting them", async () => {
    folder = await mkdtemp(path.join(tmpdir(), "wio-pixels-"));

    const runner = createPixelRunner();
    const job = (quality: number) => ({
      source: fixturePath("gradient-16bit.png"),
      format: "webp" as const,
      quality,
      output: path.join(folder, `q${quality}.webp`),
    });
    const first = runner.encode(job(50));
    const second = runner.encode(job(60));

    await new Promise((resolve) => setImmediate(resolve)); // the first starts
    await runner.close();

    await expect(first).resolves.toMatchObject({ type: "encoded" });
    await expect(second).rejects.toThrow("stopping");
    expect(existsSync(path.join(folder, "q60.webp"))).toBe(false);
  });
});
