import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
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
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareResultSchema,
  runResultSchema,
} from "../../src/schema/contract.js";
import { filesResponseSchema } from "../../src/server/api.js";
import { fixturePath } from "../fixtureManifest.js";
import { findSessionFolder } from "../server/uiSession.js";

const BIN = new URL("../../dist/bin/index.js", import.meta.url);
const SKILL = new URL("../../SKILL.md", import.meta.url);

let folder = "";

/**
 * Runs the built CLI in the test folder.
 *
 * @param args - The arguments.
 * @param onStdout - Called as each chunk of stdout arrives, with the child and everything
 * printed so far.
 * @returns The exit code, the signal that ended it, and everything it printed.
 */
async function wio(
  args: string[],
  onStdout?: (child: ReturnType<typeof spawn>, printed: string) => void
) {
  return new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(BIN), ...args], {
      cwd: folder,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      onStdout?.(child, stdout);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

/**
 * Copies fixtures into a folder below the test folder, under new names.
 *
 * @param subfolder - The folder, relative to the test folder.
 * @param copies - Pairs of fixture name and copy name.
 * @returns The copies' paths.
 */
async function copyFixtures(subfolder: string, copies: [string, string][]) {
  const target = path.join(folder, subfolder);
  const paths = [];

  await mkdir(target, { recursive: true });
  for (const [file, name] of copies) {
    paths.push(path.join(target, name));
    await copyFile(fixturePath(file), path.join(target, name));
  }
  return paths;
}

/**
 * Hashes files, to show they didn't change.
 *
 * @param paths - The files.
 */
async function hashes(paths: string[]) {
  const digests = [];

  for (const file of paths) {
    digests.push(
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex")
    );
  }
  return digests;
}

/**
 * Lists every file under the test folder, relative to it.
 */
async function listFiles() {
  const entries = await readdir(folder, { recursive: true });

  return entries.map((entry) => entry.replaceAll("\\", "/")).toSorted();
}

/**
 * Returns the `wio` commands in SKILL.md's shell blocks.
 */
async function skillCommands() {
  const text = await readFile(SKILL, "utf8");
  const blocks = text.match(/```sh\n[\s\S]*?```/g) ?? [];

  return blocks
    .flatMap((block) => block.split("\n"))
    .filter((line) => line.startsWith("wio "));
}

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "wio e2e é ü-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

// dist exists only after `npm run build`, which CI runs before the tests
describe.skipIf(!existsSync(BIN))("wio, built", () => {
  it("runs the commands in SKILL.md as written", async () => {
    const inputs = await copyFixtures("images", [
      ["display-p3.jpg", "photo.jpg"],
      ["gradient-16bit.png", "gradient.png"],
    ]);
    const before = await hashes(inputs);
    const commands = await skillCommands();

    expect(commands).toHaveLength(4);
    for (const command of commands) {
      const [, ...args] = command.split(" ");
      const { exitCode, stdout } = await wio(args);
      const schema =
        args[0] === "compare" ? compareResultSchema : runResultSchema;
      const result: unknown = JSON.parse(stdout);

      expect(exitCode, command).toBe(0);
      expect(schema.parse(result), command).toEqual(result);
    }
    expect(await hashes(inputs)).toEqual(before);
    expect(await listFiles()).toEqual([
      "images",
      "images/gradient.png",
      "images/gradient.webp",
      "images/photo.jpg",
      "images/photo.webp",
      "web",
      "web/gradient.avif",
      "web/gradient.png",
      "web/gradient.webp",
      "web/photo.avif",
      "web/photo.jpg",
      "web/photo.webp",
    ]);
  });

  it("exits 1 when a file fails and 2 for a usage error", async () => {
    await copyFixtures("images", [
      ["animated.webp", "animated.webp"],
      ["icon-6x6.png", "icon.png"],
    ]);

    const failed = await wio(["images", "--out-dir", "web", "--json"]);
    const usage = await wio(["images", "--bogus", "--json"]);

    expect(failed.exitCode).toBe(1);
    expect(
      runResultSchema.parse(JSON.parse(failed.stdout)).totals
    ).toMatchObject({ optimised: 1, failed: 1 });
    expect(usage).toMatchObject({ exitCode: 2, stdout: "" });
    expect(usage.stderr).toContain("unknown option '--bogus'");
  });

  it("writes nothing with --dry-run, and redoes a file only with --overwrite", async () => {
    const inputs = await copyFixtures("images", [["icon-6x6.png", "icon.png"]]);
    const before = await hashes(inputs);
    const args = ["images", "--out-dir", "web", "--json"];
    const statusOf = (stdout: string) =>
      runResultSchema
        .parse(JSON.parse(stdout))
        .files.map((file) => file.status);

    const dryRun = await wio([...args, "--dry-run"]);

    expect(dryRun.exitCode).toBe(0);
    expect(statusOf(dryRun.stdout)).toEqual(["optimised"]);
    expect(await listFiles()).toEqual(["images", "images/icon.png"]);

    const first = await wio(args);
    const second = await wio(args);
    const third = await wio([...args, "--overwrite"]);

    expect([first, second, third].map((run) => run.exitCode)).toEqual([
      0, 0, 0,
    ]);
    expect(statusOf(first.stdout)).toEqual(["optimised"]);
    expect(statusOf(second.stdout)).toEqual(["skipped"]);
    expect(statusOf(third.stdout)).toEqual(["optimised"]);
    expect(await hashes(inputs)).toEqual(before);
  });

  it("replaces an input only with --in-place", async () => {
    const inputs = await copyFixtures("images", [
      ["gradient-16bit.png", "gradient.png"],
    ]);
    const before = await hashes(inputs);
    const refused = await wio(["images", "--to", "same", "--json"]);
    const [file] = runResultSchema.parse(JSON.parse(refused.stdout)).files;

    expect(refused.exitCode).toBe(1);
    expect(file?.error?.code).toBe("E_OUTPUT_IS_INPUT");
    expect(await hashes(inputs)).toEqual(before);

    const replaced = await wio(["images", "--to", "same", "--in-place"]);

    expect(replaced.exitCode).toBe(0);
    expect(await hashes(inputs)).not.toEqual(before);
    expect(await listFiles()).toEqual(["images", "images/gradient.png"]);
  });

  it.skipIf(process.platform === "win32")(
    "stops on Ctrl+C with exit code 130, leaving no temp files",
    async () => {
      await copyFixtures("images", [
        ["logo-alpha.png", "logo.png"],
        ["semi-transparent.png", "semi.png"],
      ]);

      const { exitCode, stderr } = await wio(
        ["images", "--to", "suite", "--out-dir", "web", "--ndjson"],
        (child) => child.kill("SIGINT") // the first event means the handlers are in place
      );
      const files = await listFiles();

      expect(exitCode).toBe(130);
      expect(stderr).toContain("wio: stopping");
      expect(files.filter((file) => file.endsWith(".tmp"))).toEqual([]);
    }
  );

  it.skipIf(process.platform === "win32")(
    "serves the UI until Ctrl+C, then removes its temp folder",
    async () => {
      await copyFixtures("images", [["logo-alpha.png", "logo.png"]]);

      let probe: Promise<{ folder: string; files: unknown }> | undefined;
      const { exitCode, stdout } = await wio(
        ["ui", "images", "--no-open"],
        (child, printed) => {
          if (!printed.endsWith("\n")) {
            return; // the address may arrive in pieces
          }
          probe ??= (async () => {
            try {
              const url = printed.trim();
              const exchange = await fetch(url, { redirect: "manual" });
              const cookie = exchange.headers.get("set-cookie")?.split(";")[0];
              const api = (pathname: string, init: RequestInit = {}) =>
                fetch(new URL(pathname, url), {
                  ...init,
                  headers: { cookie: cookie ?? "" },
                });
              const files = filesResponseSchema.parse(
                await (await api("/api/files")).json()
              );

              return { folder: await findSessionFolder(api), files };
            } finally {
              child.kill("SIGINT"); // even when the probe fails, so the test doesn't hang
            }
          })();
        }
      );
      const probed = await probe;

      expect(exitCode).toBe(130);
      expect(stdout).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=/);
      expect(probed?.files).toMatchObject({
        files: [{ ref: "root/logo.png" }],
      });
      expect(probed?.folder).toMatch(/\.wio-ui-\w+$/);
      expect(existsSync(probed?.folder ?? "")).toBe(false);
    }
  );
});
