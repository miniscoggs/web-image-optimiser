import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OptimiserError } from "../schema/index.js";
import ApiError from "./ApiError.js";
import type { ServerContext } from "./context.js";
import createFileRoutes from "./fileRoutes.js";
import { findRoute, forwardingPage, readCookie } from "./http.js";
import createPixelRoutes from "./pixelRoutes.js";
import { isPlainPart } from "./refs.js";
import createRunRoute from "./runRoute.js";
import createWriteRoute from "./writeRoute.js";

const UI_FOLDER = fileURLToPath(new URL("../ui/", import.meta.url)); // dist/ui, which the build writes

const UI_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const HARDENING = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

/**
 * Returns whether a token offered with a request is the session's, in constant time.
 *
 * @param offered - The token offered, if any.
 * @param token - The session's token.
 */
function isSessionToken(offered: string | undefined, token: string) {
  const expected = Buffer.from(token);
  const actual = Buffer.from(offered ?? "");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Returns whether a request says it comes from another page than the UI, through the
 * `Sec-Fetch-Site` and `Origin` headers browsers send. Browsers send the session cookie from
 * every port of 127.0.0.1, so the cookie alone doesn't show that the UI sent a request.
 *
 * @param request - The request.
 * @param origin - The server's own origin.
 */
function isForeign(request: Request, origin: string) {
  const site = request.headers.get("sec-fetch-site");
  const from = request.headers.get("origin");

  return (
    (site !== null && site !== "same-origin" && site !== "none") || // none: an address opened or typed
    (from !== null && from !== origin)
  );
}

/**
 * Refuses a request: JSON for the API, text for a page.
 *
 * @param url - The request's address.
 * @param status - The status.
 * @param message - Why, for people.
 */
function refuse(url: URL, status: number, message: string) {
  return url.pathname.startsWith("/api/")
    ? Response.json({ error: message }, { status })
    : new Response(message, { status });
}

/**
 * Turns a failure into its response: an {@link ApiError}'s status, 422 with the code for an
 * {@link OptimiserError}, and 500 for anything else.
 *
 * @param error - What was thrown.
 */
function failureOf(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json(
      {
        error: error.message,
        ...(error.code === undefined ? {} : { code: error.code }),
      },
      { status: error.status }
    );
  }
  if (error instanceof OptimiserError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: 422 }
    );
  }

  const message = error instanceof Error ? error.message : String(error);

  return Response.json({ error: message }, { status: 500 });
}

/**
 * Reads a file of the built UI, if there is one at a page's path.
 *
 * @param pathname - The page's path, URL-encoded.
 */
async function uiFile(pathname: string) {
  let relative = "index.html";

  try {
    relative =
      pathname === "/" ? relative : decodeURIComponent(pathname.slice(1));
  } catch {
    return undefined;
  }

  const parts = relative.split("/");
  const filePath = path.join(UI_FOLDER, ...parts);
  const bytes = parts.every(isPlainPart)
    ? await readFile(filePath).catch(() => undefined) // missing, or a folder
    : undefined;

  return bytes === undefined
    ? undefined
    : new Response(new Uint8Array(bytes), {
        headers: {
          "content-type":
            UI_TYPES[path.extname(filePath)] ?? "application/octet-stream",
        },
      });
}

/**
 * Creates the UI server's request handler: the session check, the API under `/api`, and the
 * built UI.
 *
 * A `GET /?token=` with the session token sets the session cookie and moves on to `/`. Every
 * other request needs that cookie, and one that says it comes from another page is refused.
 * Every response gets hardening headers and no CORS headers.
 *
 * @param context - The server's state.
 */
function createApp(context: ServerContext) {
  const routes = {
    ...createFileRoutes(context),
    ...createRunRoute(context),
    ...createPixelRoutes(context),
    ...createWriteRoute(context),
  };

  const handle = async (request: Request) => {
    const url = new URL(request.url);
    const offered =
      request.method === "GET" && url.pathname === "/"
        ? url.searchParams.get("token")
        : null;
    const needsToken =
      "This needs the session token: open the address that wio ui printed";

    if (offered !== null) {
      // the token vouches for itself, even from the file wio ui opens, which counts as another
      // site; and a page, unlike a redirect, moves on to / as this site, so the cookie goes too
      return isSessionToken(offered, context.token)
        ? new Response(forwardingPage("/"), {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "set-cookie": `${context.cookie}=${context.token}; Path=/; HttpOnly; SameSite=Strict`,
            },
          })
        : refuse(url, 401, needsToken);
    }
    if (isForeign(request, url.origin)) {
      return refuse(url, 403, "Only the wio UI's own page can use this server");
    }
    if (!isSessionToken(readCookie(request, context.cookie), context.token)) {
      return refuse(url, 401, needsToken);
    }

    const found = findRoute(routes, request.method, url.pathname);

    if (found !== undefined) {
      return found.route(request, found.rest);
    }
    if (url.pathname.startsWith("/api/")) {
      return refuse(url, 404, "No such endpoint");
    }

    const file =
      request.method === "GET" ? await uiFile(url.pathname) : undefined;

    return (
      file ??
      refuse(
        url,
        404,
        existsSync(UI_FOLDER)
          ? "Not found"
          : "The UI hasn't been built: run npm run build"
      )
    );
  };

  return async (request: Request) => {
    const response = await handle(request).catch(failureOf);

    for (const [name, value] of Object.entries(HARDENING)) {
      if (!response.headers.has(name)) {
        response.headers.set(name, value);
      }
    }
    return response;
  };
}

export default createApp;
