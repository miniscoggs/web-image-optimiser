import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import createApp from "./createApp.js";
import createPixelRunner from "./createPixelRunner.js";
import type { ServerContext } from "./context.js";
import { forwardingPage } from "./http.js";
import type { UiServer, UiServerOptions } from "./types.js";

/**
 * Answers a Node request with the app's web-standard handler, streaming both bodies. The
 * request's signal aborts when the connection closes.
 *
 * @param app - The handler.
 * @param incoming - The request.
 * @param outgoing - Its response.
 * @param origin - The server's origin, which every request's address is resolved against.
 */
async function respond(
  app: (request: Request) => Promise<Response>,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  origin: string
) {
  const closed = new AbortController();
  const method = incoming.method ?? "GET";
  const headers = new Headers();
  const target = incoming.url?.startsWith("/") ? incoming.url : "/"; // never another host, as in `GET //evil`

  outgoing.once("close", () => {
    closed.abort();
  });
  for (let index = 0; index + 1 < incoming.rawHeaders.length; index += 2) {
    headers.append(
      incoming.rawHeaders[index] ?? "",
      incoming.rawHeaders[index + 1] ?? ""
    );
  }

  const request = new Request(`${origin}${target}`, {
    method,
    headers,
    body:
      method === "GET" || method === "HEAD"
        ? undefined
        : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>),
    duplex: "half",
    signal: closed.signal,
  });
  const response = await app(request);

  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null || method === "HEAD") {
    outgoing.end();
    return;
  }
  await pipeline(
    Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
    outgoing
  ).catch(() => undefined); // the page went away mid-response
}

/**
 * Starts the UI server; {@link startUiServer} is its public, lazily loaded entry.
 *
 * @param options - The folder to serve, and the port.
 * @throws Error when `root` isn't a folder or the port can't be used.
 */
async function listen(options: UiServerOptions): Promise<UiServer> {
  const root = await realpath(options.root).catch(() => undefined); // real paths, since refs are checked against them
  const stats = root === undefined ? undefined : await stat(root);

  if (root === undefined || stats?.isDirectory() !== true) {
    throw new Error(`${options.root} is not a folder`);
  }

  const created = await mkdtemp(path.join(tmpdir(), ".wio-ui-")); // hidden, so serving a folder above it doesn't list it
  const session = await realpath(created);
  const controller = new AbortController();
  let folders = 0;
  const context: ServerContext = {
    folders: { root, session },
    token: randomBytes(32).toString("base64url"),
    cookie: "",
    stopped: controller.signal,
    pixels: createPixelRunner(),
    run: undefined,
    nextFolder: (kind) => path.join(session, kind, String((folders += 1))),
    encodes: new Map(),
    diffs: new Map(),
  };
  const app = createApp(context);
  const inFlight = new Set<Promise<void>>();
  let origin = "";
  let closing: Promise<void> | undefined;
  const server = createServer((incoming, outgoing) => {
    if (closing !== undefined) {
      outgoing.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      outgoing.end("The wio UI server is stopping");
      return;
    }

    const answered = respond(app, incoming, outgoing, origin).catch(() => {
      outgoing.destroy(); // a bug, since the app answers its own errors
    });

    inFlight.add(answered);
    void answered.finally(() => inFlight.delete(answered));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await rm(session, { recursive: true, force: true });
    throw error;
  }

  const { port } = server.address() as AddressInfo;

  origin = `http://127.0.0.1:${port}`;
  context.cookie = `wio-${port}`; // cookies ignore the port, so each server needs a name of its own
  const url = `${origin}/?token=${context.token}`;
  const openFile = path.join(session, "open.html");

  await writeFile(openFile, forwardingPage(url), { mode: 0o600 }); // in a folder only this user can open
  const close = async () => {
    const stopped = new Promise((resolve) => server.close(resolve)); // no new connections

    controller.abort(); // stops a run
    await context.pixels.close();
    await Promise.allSettled(inFlight); // a stopped run's stream ends once its files clean up
    server.closeAllConnections();
    await stopped;
    await rm(session, { recursive: true, force: true });
  };

  return { url, openFile, close: () => (closing ??= close()) };
}

export default listen;
