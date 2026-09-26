import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import { startUiServer } from "../server/index.js";
import type { CliIo } from "./types.js";

/**
 * The ui command's flags, as commander parses them.
 */
type UiFlags = {
  port?: number;
  open: boolean;
};

/**
 * Rejects with a signal's reason once it aborts, at once if it already has, or never without
 * one.
 *
 * @param signal - The signal.
 */
function untilAborted(signal: AbortSignal | undefined) {
  return new Promise<never>((_resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason as Error); // eg Ctrl+C while the server was starting
      return;
    }
    signal?.addEventListener(
      "abort",
      () => {
        reject(signal.reason as Error);
      },
      { once: true }
    );
  });
}

/**
 * Runs the ui command: serves a folder's images to the comparison UI, prints the address on
 * stdout and opens it, then runs until stopped.
 *
 * @param folder - The folder to serve, if given.
 * @param flags - The flags.
 * @param io - Where to write, the signal that stops the server, and what opens the browser.
 * @param command - The command, which reports usage errors.
 * @returns 1 when the server can't start; otherwise it rejects with the signal's reason once
 * stopped.
 */
async function runUi(
  folder: string | undefined,
  flags: UiFlags,
  io: CliIo,
  command: Command
) {
  const root = path.resolve(folder ?? ".");
  const stats = await stat(root).catch(() => undefined);

  if (stats?.isDirectory() !== true) {
    command.error(`error: ${folder ?? root} is not a folder`, { exitCode: 2 });
  }

  let server;

  try {
    server = await startUiServer({ root, port: flags.port });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    io.stderr.write(`wio: the UI server could not start: ${detail}\n`);
    return 1;
  }
  try {
    io.stdout.write(`${server.url}\n`);
    io.stderr.write(
      `wio: serving ${root} to the address above; press Ctrl+C to stop\n`
    );
    if (flags.open && io.signal?.aborted !== true) {
      io.openUrl?.(pathToFileURL(server.openFile).href);
    }
    return await untilAborted(io.signal);
  } finally {
    await server.close();
  }
}

export default runUi;
export type { UiFlags };
