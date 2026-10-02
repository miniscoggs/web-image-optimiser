import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";
import type { ElectronApplication, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspect } from "../../src/inspect/index.js";
import METADATA_SUMMARY from "../../src/rights/metadataSummary.js";
import { fixturePath } from "../fixtureManifest.js";

// drives the built desktop app with the os's dialogs stubbed in its main process, or the packaged
// app whose executable WIO_DESKTOP_APP names. the tests run in order, each carrying on from the
// one before. `npm run test:desktop` runs them after `npm run build:desktop`, under xvfb-run on
// linux

/**
 * What a stubbed dialog records in the main process.
 */
type DialogRecord = { wioDialogPath?: string };

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BUILT = [
  "dist/app/index.js",
  "desktop/build/main/index.js",
  "desktop/build/preload/index.cjs",
  "desktop/build/renderer/index.html",
];
const FIXTURES = ["gradient-16bit.png", "logo-alpha.png", "icon-6x6.png"];
const COPYRIGHT = "Copyright 2026 Test Studio";
const TAKEN =
  process.platform === "darwin" ? "logo-alpha 2.webp" : "logo-alpha (1).webp"; // each os's own free name
const OUTPUT_NAME = /^(gradient-16bit|logo-alpha)\.(avif|webp|png)$/;
const RUN_TIMEOUT = 90_000;
const PACKAGED = process.env.WIO_DESKTOP_APP;

let folder = "";
let images = "";
let app: ElectronApplication | undefined;
let page: Page;
const problems: string[] = [];

/**
 * Returns the environment to launch the app in: the test's own, without the variables that make
 * Electron run as plain Node, which an editor built on Electron sets, or serve the page from Vite.
 */
function appEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        entry[0] !== "ELECTRON_RUN_AS_NODE" &&
        entry[0] !== "WIO_DEV_SERVER"
    )
  );
}

/**
 * Returns the executable and arguments that start the built or packaged app with its user data
 * in the test's folder.
 *
 * @param files - The paths to name on its command line.
 */
function appCommandLine(files: string[]) {
  const userData = `--user-data-dir=${path.join(folder, "user-data")}`;

  return PACKAGED === undefined
    ? {
        executablePath: createRequire(import.meta.url)("electron") as string, // its path, from node
        args: [path.resolve(ROOT), userData, ...files], // without the trailing separator, which playwright's launch fails on
      }
    : { executablePath: PACKAGED, args: [userData, ...files] };
}

/**
 * Launches the app, and records the page's console errors, CSP violations included, and uncaught
 * errors.
 *
 * @param files - The paths to name on its command line.
 */
async function launch(files: string[] = []) {
  const launched = await _electron.launch({
    ...appCommandLine(files),
    env: appEnvironment(),
    chromiumSandbox: true, // playwright turns it off on linux unless asked
  });

  app = launched;
  page = await launched.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    problems.push(error.message);
  });
}

/**
 * Starts the app again while it runs, as the OS does for Open with on Windows, and waits for this
 * second copy to hand its files to the running one and quit.
 *
 * @param files - The paths to name on its command line.
 * @param cwd - The folder it starts in, which a relative path is resolved against.
 */
async function launchAgain(files: string[], cwd: string) {
  const { executablePath, args } = appCommandLine(files);
  const second = spawn(executablePath, args, {
    cwd,
    env: appEnvironment(),
    stdio: "ignore",
  });
  const [code] = (await once(second, "exit")) as [number | null];

  expect(code).toBe(0);
}

/**
 * Returns the running app, which `beforeAll` launched.
 */
function running() {
  if (app === undefined) {
    throw new Error("The app isn't running");
  }
  return app;
}

/**
 * Stubs the open dialog, which also picks Save suite's folder, to choose the paths given, or to
 * be dismissed when there are none, recording the folder it would have started in.
 *
 * @param filePaths - The paths to choose.
 */
async function chooseInOpenDialog(filePaths: string[]) {
  await running().evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (...args: unknown[]) => {
      const options = args.at(-1) as { defaultPath?: string };

      (globalThis as DialogRecord).wioDialogPath = options.defaultPath;
      return Promise.resolve({
        canceled: chosen.length === 0,
        filePaths: chosen,
      });
    };
  }, filePaths);
}

/**
 * Returns the folder the open dialog last started in.
 */
function openDialogFolder() {
  return running().evaluate(() => (globalThis as DialogRecord).wioDialogPath);
}

/**
 * Stubs the save dialog to choose a path, or the name it suggests when none is given.
 *
 * @param filePath - The path to choose.
 */
async function chooseInSaveDialog(filePath?: string) {
  await running().evaluate(({ dialog }, chosen) => {
    dialog.showSaveDialog = (...args: unknown[]) => {
      const options = args.at(-1) as { defaultPath?: string };

      return Promise.resolve({
        canceled: false,
        filePath: chosen ?? options.defaultPath ?? "",
      });
    };
  }, filePath);
}

/**
 * Returns an image's row in the slide-over.
 *
 * @param name - The image's file name.
 */
function imageRow(name: string) {
  return page
    .getByRole("complementary", { name: "Images" })
    .getByRole("button", { name });
}

/**
 * Waits until an image's row says it is done.
 *
 * @param name - The image's file name.
 */
async function waitUntilDone(name: string) {
  await imageRow(name)
    .getByRole("status")
    .filter({ hasText: /^Done/ })
    .waitFor({ timeout: RUN_TIMEOUT });
}

/**
 * Returns a pane of the grid shown.
 *
 * @param title - The pane's title, eg `PNG fallback`.
 */
function pane(title: string) {
  return page
    .getByRole("main")
    .getByRole("region", { name: title, exact: true });
}

/**
 * Returns the widths the grid's outputs decode at, each once, for the original's width not to
 * count.
 */
async function outputWidths() {
  const widths = await page
    .getByRole("main")
    .getByRole("img")
    .evaluateAll((elements: unknown[]) =>
      (elements as { alt: string; naturalWidth: number }[])
        .filter(({ alt }) => alt !== "Original")
        .map(({ naturalWidth }) => naturalWidth)
    );

  return [...new Set(widths)];
}

/**
 * Returns each file in a folder with its size and modification time.
 *
 * @param folderPath - The folder.
 */
async function folderState(folderPath: string) {
  const names = await readdir(folderPath);
  const entries = await Promise.all(
    names.map(async (name) => {
      const { size, mtimeMs } = await stat(path.join(folderPath, name));

      return [name, { size, mtimeMs }] as const;
    })
  );

  return Object.fromEntries(entries);
}

describe("desktop app", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    const missing =
      PACKAGED === undefined
        ? BUILT.filter((file) => !existsSync(path.join(ROOT, file)))
        : [];

    if (missing.length > 0) {
      throw new Error(
        `Run npm run build:desktop first: ${missing.join(", ")} missing`
      );
    }
    folder = await mkdtemp(path.join(tmpdir(), "wio-desktop-"));
    images = path.join(folder, "images");
    await mkdir(images);
    for (const name of FIXTURES) {
      await copyFile(fixturePath(name), path.join(images, name));
    }
    await writeFile(path.join(images, "logo-alpha.webp"), "taken");
    await launch();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  });

  it("opens images from the open dialog and runs each one's suite", async () => {
    await chooseInOpenDialog([
      path.join(images, "gradient-16bit.png"),
      path.join(images, "logo-alpha.png"),
    ]);
    await page.getByRole("button", { name: "Browse" }).click();
    await waitUntilDone("gradient-16bit.png");
    await waitUntilDone("logo-alpha.png");

    expect(
      await page
        .getByRole("heading", { name: "gradient-16bit.png" })
        .isVisible()
    ).toBe(true); // the first image's grid
  });

  it("regenerates a pane from its target slider, and wipes it against the original", async () => {
    await imageRow("logo-alpha.png").click();
    await page.getByRole("heading", { name: "logo-alpha.png" }).waitFor();

    const webp = pane("WebP");
    const slider = webp.getByRole("slider", { name: "WebP target score" });

    for (let step = 0; step < 2; step += 1) {
      await slider.press("ArrowRight"); // from the run's web target, 70, to 80 in steps of 5
    }
    expect(await slider.inputValue()).toBe("80");
    await webp
      .locator(`img[src*="${encodeURIComponent("session/searches/")}"]`)
      .waitFor({ timeout: RUN_TIMEOUT });

    const wipe = page.getByRole("region", {
      name: "Original against the WebP",
    });

    await webp.getByRole("button", { name: "Wipe" }).click();
    await wipe.waitFor();
    await page.keyboard.press("Escape");
    await wipe.waitFor({ state: "hidden" });
    await webp.waitFor();
  });

  it("saves a pane under the next free name when its own is taken", async () => {
    const webp = pane("WebP");

    await chooseInSaveDialog();
    await webp.getByRole("button", { name: "Save", exact: true }).click();
    await webp.getByText(`Saved as ${TAKEN}`).waitFor();

    expect((await inspect(path.join(images, TAKEN))).format).toBe("webp");
    expect(await readFile(path.join(images, "logo-alpha.webp"), "utf8")).toBe(
      "taken"
    );
  });

  it("saves every finished image's suite from Save all and from the menu", async () => {
    const before = await folderState(images);
    const saveAll = path.join(folder, "save-all");
    const menuSaveAll = path.join(folder, "menu-save-all");

    await mkdir(saveAll);
    await chooseInOpenDialog([saveAll]);
    await page
      .getByRole("complementary", { name: "Images" })
      .getByRole("button", { name: "Save all" })
      .click();

    const note = page.getByText(`to ${saveAll}`);

    await note.waitFor();

    const saved = await readdir(saveAll);

    expect(await note.textContent()).toMatch(
      new RegExp(`^Saved ${saved.length} files? to `)
    );
    for (const stem of ["gradient-16bit", "logo-alpha"]) {
      expect(saved.some((name) => name.startsWith(`${stem}.`))).toBe(true);
    }
    for (const name of saved) {
      const original = name.startsWith("logo-alpha")
        ? "logo-alpha.png"
        : "gradient-16bit.png";
      const { size } = await stat(path.join(saveAll, name));

      expect(name).toMatch(OUTPUT_NAME);
      expect(size).toBeLessThan((await stat(path.join(images, original))).size);
    }
    expect(await folderState(images)).toEqual(before);

    await mkdir(menuSaveAll);
    await chooseInOpenDialog([menuSaveAll]);
    await running().evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("save-all");

      if (item !== null && item !== undefined) {
        Reflect.apply(item.click, item, []); // electron types it as Function
      }
    });
    await page.getByText(`to ${menuSaveAll}`).waitFor();

    expect((await readdir(menuSaveAll)).toSorted()).toEqual(saved.toSorted());
  });

  it("runs every image again at a maximum width", async () => {
    await page.getByLabel("Max width").fill("100");

    await expect
      .poll(outputWidths, { timeout: RUN_TIMEOUT, interval: 250 })
      .toEqual([100]);
  });

  it("opens Help with the metadata summary", async () => {
    const help = page.getByRole("group", { name: "Help" });

    await page.getByRole("button", { name: "Help" }).click();
    await help.getByText(METADATA_SUMMARY.kept).waitFor();
    await page.keyboard.press("Escape");
    await help.waitFor({ state: "hidden" });
  });

  it("marks a pane the rights make larger than its original, with no Save", async () => {
    await chooseInOpenDialog([path.join(images, "icon-6x6.png")]);
    await page.getByRole("button", { name: "Open...", exact: true }).click();
    await waitUntilDone("icon-6x6.png");
    await imageRow("icon-6x6.png").click();
    await page.getByRole("heading", { name: "icon-6x6.png" }).waitFor();

    const main = page.getByRole("main");

    expect(
      await main.getByRole("button", { name: "Save", exact: true }).count()
    ).toBeGreaterThan(0);

    await page
      .getByRole("button", { name: "Rights info", exact: true })
      .click();
    await page
      .getByRole("group", { name: "Rights info" })
      .getByLabel("Copyright Notice")
      .fill(COPYRIGHT);
    await page.keyboard.press("Escape");
    await main
      .getByText("Larger than the original")
      .first()
      .waitFor({ timeout: RUN_TIMEOUT });

    expect(
      await main.getByRole("button", { name: "Save", exact: true }).count()
    ).toBe(0);
    expect(
      await main.getByRole("button", { name: "Save suite" }).isDisabled()
    ).toBe(true);
  });

  it("saves a pane with the rights added, and with every field removed", async () => {
    const withRights = path.join(folder, "with-rights.png");
    const stripped = path.join(folder, "stripped.png");
    const fallback = pane("PNG fallback");
    const image = fallback.getByRole("img", {
      name: "PNG fallback",
      exact: true,
    });

    await imageRow("logo-alpha.png").click();
    await fallback
      .locator(`img[src*="${encodeURIComponent("session/rights/")}"]`)
      .waitFor({ timeout: RUN_TIMEOUT });
    await chooseInSaveDialog(withRights);
    await fallback.getByRole("button", { name: "Save", exact: true }).click();
    await fallback.getByText("Saved as with-rights.png").waitFor();

    expect((await inspect(withRights)).rights).toEqual({
      copyright: [{ lang: "x-default", value: COPYRIGHT }],
    });

    const shown = await image.getAttribute("src");

    await page.getByLabel("Remove all metadata").check();
    await expect
      .poll(() => image.getAttribute("src"), { timeout: RUN_TIMEOUT })
      .not.toBe(shown);
    await chooseInSaveDialog(stripped);
    await fallback.getByRole("button", { name: "Save", exact: true }).click();
    await fallback.getByText("Saved as stripped.png").waitFor();

    const strippedFile = await inspect(stripped);

    expect(strippedFile.metadata).not.toContain("xmp");
    expect(strippedFile.rights).toEqual({});
  });

  it("starts again in the last folder, with the options kept", async () => {
    await running().close();
    await launch();

    const maxWidth = page.getByLabel("Max width");

    await expect.poll(() => maxWidth.inputValue()).toBe("100");
    expect(await page.getByLabel("Remove all metadata").isChecked()).toBe(true);
    await page
      .getByRole("button", { name: "Rights info", exact: true })
      .click();
    expect(await page.getByLabel("Copyright Notice").inputValue()).toBe(
      COPYRIGHT
    );
    await page.keyboard.press("Escape");

    await chooseInOpenDialog([]);
    await page.getByRole("button", { name: "Browse" }).click();
    await expect.poll(openDialogFolder).toBe(images);
  });

  it("opens the images its command line names, and a second launch's", async () => {
    await running().close();
    await launch([path.join(images, "icon-6x6.png")]);
    await page
      .getByRole("heading", { name: "icon-6x6.png" })
      .waitFor({ timeout: RUN_TIMEOUT });

    await launchAgain(["logo-alpha.png"], images);
    await waitUntilDone("icon-6x6.png");
    await waitUntilDone("logo-alpha.png");
  });

  it("logs no console errors or CSP violations", () => {
    expect(problems).toEqual([]);
  });
});
