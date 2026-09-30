import { net, protocol } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP_HEADERS } from "#app";
import type { AppApi } from "#app";

const RENDERER = fileURLToPath(new URL("../renderer/", import.meta.url));

/**
 * Returns a copy of a response with headers set, since a fetched response's own can't change.
 *
 * @param response - The response.
 * @param headers - The headers to set.
 */
function withHeaders(response: Response, headers: Record<string, string>) {
  const merged = new Headers(response.headers);

  for (const [name, value] of Object.entries(headers)) {
    merged.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

/**
 * Returns the headers for the page in development: the app's, with Vite's inline scripts and
 * its hot-reload socket allowed.
 *
 * @param devServer - Vite's address.
 */
function devHeaders(devServer: string) {
  const socket = new URL(devServer);

  socket.protocol = "ws:";
  return {
    ...APP_HEADERS,
    "content-security-policy": `${APP_HEADERS["content-security-policy"]}; script-src 'self' 'unsafe-inline'; connect-src 'self' ${socket.origin}`,
  };
}

/**
 * Reads one of the renderer build's files, or answers 404 for a path outside it or a file that
 * isn't there.
 *
 * @param url - The requested URL.
 */
async function rendererFile(url: URL) {
  const notFound = new Response("Not found", { status: 404 });
  let relative: string;

  try {
    relative =
      url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname);
  } catch {
    return notFound; // a malformed escape
  }

  const file = path.join(RENDERER, relative);

  if (path.relative(RENDERER, file).startsWith("..")) {
    return notFound;
  }
  return net.fetch(pathToFileURL(file).href).catch(() => notFound);
}

/**
 * Serves the `wio:` scheme: the app API under `/api/`, and the page, from the renderer build or,
 * in development, from Vite, so the page keeps one origin. Every page response gets the app's
 * headers, as the API's do.
 *
 * @param api - The app API.
 * @param devServer - Vite's address in development.
 */
function registerAppProtocol(api: AppApi, devServer: string | undefined) {
  const headers = devServer === undefined ? APP_HEADERS : devHeaders(devServer);

  protocol.handle("wio", async (request) => {
    const url = new URL(request.url);

    if (url.host !== "app") {
      return withHeaders(new Response("Not found", { status: 404 }), headers);
    }
    if (url.pathname.startsWith("/api/")) {
      return api.handle(request);
    }

    const page =
      devServer === undefined
        ? await rendererFile(url)
        : await net.fetch(new URL(url.pathname + url.search, devServer).href);

    return withHeaders(page, headers);
  });
}

export default registerAppProtocol;
