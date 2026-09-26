/**
 * Answers an API request. `rest` is what follows a route ending in `*`, still URL-encoded.
 */
type ServerRoute = (request: Request, rest: string) => Promise<Response>;

/**
 * API routes by method and path, eg `POST /api/encode`. A path ending in `*` matches every path
 * that starts with what comes before it.
 */
type ServerRoutes = Record<string, ServerRoute>;

/**
 * Finds a request's route, and what follows a route ending in `*`.
 *
 * @param routes - The routes.
 * @param method - The request's method.
 * @param pathname - The request's path.
 */
function findRoute(routes: ServerRoutes, method: string, pathname: string) {
  const key = `${method} ${pathname}`;
  const exact = routes[key];

  if (exact !== undefined) {
    return { route: exact, rest: "" };
  }
  for (const [pattern, route] of Object.entries(routes)) {
    const prefix = pattern.slice(0, -1);

    if (
      pattern.endsWith("*") &&
      key.startsWith(prefix) &&
      key.length > prefix.length
    ) {
      return { route, rest: key.slice(prefix.length) };
    }
  }
  return undefined;
}

/**
 * Returns a page that sends the browser on to another address as soon as it loads.
 *
 * @param address - The address, which holds nothing HTML would need escaped.
 */
function forwardingPage(address: string) {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${address}"><link rel="icon" href="data:,"><title>wio</title><a href="${address}">Open the wio UI</a>\n`; // an empty icon, or browsers ask for /favicon.ico
}

/**
 * Returns a cookie a request carries, if it has one by that name.
 *
 * @param request - The request.
 * @param name - The cookie's name.
 */
function readCookie(request: Request, name: string) {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = pair.trim().split("=");

    if (key === name) {
      return value.join("=");
    }
  }
  return undefined;
}

export { findRoute, forwardingPage, readCookie };
export type { ServerRoute, ServerRoutes };
