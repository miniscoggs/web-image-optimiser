#!/usr/bin/env node
/**
 * CLI entry for `wio` and `web-image-optimiser`, and the only module that reads
 * `process.env` or `process.argv`.
 *
 * Ctrl+C or SIGTERM stops the run once the files in progress finish their current step, which
 * leaves no temp files, then exits 130 or 143. A second signal exits at once.
 */
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { runCli } from "../cli/index.js";

const OPENERS: Partial<Record<NodeJS.Platform, string>> = {
  win32: "explorer.exe",
  darwin: "open",
};

const controller = new AbortController();
let received: NodeJS.Signals | undefined;

/**
 * Opens an address in the default browser, ignoring a failure, since `wio ui` also prints
 * its address. It is the file URL of the UI's forwarding page, not the address with its token.
 *
 * @param url - The address.
 */
function openUrl(url: string) {
  const opener = OPENERS[process.platform] ?? "xdg-open";
  const child = spawn(opener, [url], { detached: true, stdio: "ignore" });

  child.on("error", () => undefined);
  child.unref();
}

/**
 * Stops the run on the first signal, and exits at once on the next.
 *
 * @param signal - The signal.
 */
function onSignal(signal: NodeJS.Signals) {
  if (received !== undefined) {
    process.exit(128 + constants.signals[signal]); // temp files exist only while outputs are written, so one left behind is unlikely
  }
  received = signal;
  process.stderr.write(
    "\nwio: stopping once the files in progress finish their current step; press Ctrl+C again to quit at once\n"
  );
  controller.abort();
}

process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
try {
  process.exitCode = await runCli(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    color: process.stdout.isTTY && process.stdout.hasColors(process.env), // false for NO_COLOR
    progress: process.stderr.isTTY,
    signal: controller.signal,
    openUrl,
  });
} catch (error) {
  if (received === undefined) {
    throw error;
  }
  process.exitCode = 128 + constants.signals[received];
} finally {
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}
