import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import createPixelRunner from "../../src/app/createPixelRunner.js";
import { fixturePath } from "../fixtureManifest.js";

let folder = "";

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("createPixelRunner", () => {
  it("finishes the job under way on close, and fails the queued ones without starting them", async () => {
    folder = await mkdtemp(path.join(tmpdir(), "wio-pixels-"));

    const runner = createPixelRunner();
    const job = (target: number) => ({
      source: fixturePath("gradient-16bit.png"),
      format: "webp" as const,
      settings: { target, stripAll: false },
      output: path.join(folder, `t${target}.webp`),
    });
    const first = runner.search(job(70));
    const second = runner.search(job(80));

    await new Promise((resolve) => setImmediate(resolve)); // the first starts
    await runner.close();

    await expect(first).resolves.toMatchObject({ type: "searched" });
    await expect(second).rejects.toThrow("stopping");
    expect(existsSync(path.join(folder, "t80.webp"))).toBe(false);
  });
});
