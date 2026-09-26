import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UiServer } from "../../src/index.js";
import { fixturePath } from "../fixtureManifest.js";

type Library = typeof import("../../src/index.js");

const DIST_ENTRY = new URL("../../dist/index.js", import.meta.url);
const HOOK_TIMEOUT = 60_000; // chrome starts and stops slowly while the golden shards fill every core

let folder = "";
let server: UiServer | undefined;
let browser: Browser | undefined;

// drives the built server and ui in google chrome, which ci's ubuntu runners have installed;
// dist exists only after `npm run build`
describe.skipIf(!existsSync(DIST_ENTRY))("wio ui in a browser", () => {
  beforeAll(async () => {
    const library = (await import(DIST_ENTRY.href)) as Library;

    folder = await mkdtemp(path.join(tmpdir(), "wio-browser-"));
    await copyFile(
      fixturePath("logo-alpha.png"),
      path.join(folder, "logo-alpha.png")
    );
    server = await library.startUiServer({ root: folder });
    browser = await chromium.launch({ channel: "chrome" });
  }, HOOK_TIMEOUT);
  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await rm(folder, { recursive: true, force: true });
  }, HOOK_TIMEOUT);

  it("opens from its forwarding page, runs an image, compares it, slides its quality and writes it", async () => {
    if (server === undefined || browser === undefined) {
      throw new Error("the server and browser should have started");
    }

    const page = await browser.newPage();
    const errors: string[] = [];

    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text()); // including csp reports
      }
    });
    await page.goto(pathToFileURL(server.openFile).href); // as wio ui opens it, from its forwarding page
    await page.getByText("logo-alpha.png", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Run 1 image" }).click();
    await page.getByRole("button", { name: "Compare logo-alpha.png" }).click();

    const webp = page.getByRole("region", { name: "WebP" });

    await webp.getByText("near-lossless 20", { exact: true }).waitFor();
    await webp.getByRole("slider", { name: "WebP quality" }).focus();
    await page.keyboard.press("Home");
    await webp.getByText("q30", { exact: true }).waitFor();
    expect(
      await webp.getByRole("img", { name: "WebP" }).getAttribute("src")
    ).toMatch(/^\/api\/image\/session%2Fencodes%2F/);
    expect(await readdir(folder)).toEqual(["logo-alpha.png"]);

    await webp.getByRole("button", { name: "Write" }).click();
    await webp.getByText("Saved as logo-alpha.webp").waitFor();

    const written = await stat(path.join(folder, "logo-alpha.webp"));
    const original = await stat(path.join(folder, "logo-alpha.png"));

    expect(written.size).toBeLessThan(original.size);
    expect(await readdir(folder)).toEqual([
      "logo-alpha.png",
      "logo-alpha.webp",
    ]);
    expect(errors).toEqual([]);
  });
});
