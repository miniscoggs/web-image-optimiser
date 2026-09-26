#!/usr/bin/env node
/**
 * CLI entry for `wio` and `web-image-optimiser`, and the only module that reads
 * `process.env` or `process.argv`.
 *
 * Ctrl+C or SIGTERM stops the run once the files in progress finish their current step, which
 * leaves no temp files, then exits 130 or 143. A second signal exits at once.
 */
import { constants } from "node:os";
import { runCli } from "../cli/index.js";

const controller = new AbortController();
let received: NodeJS.Signals | undefined;

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
