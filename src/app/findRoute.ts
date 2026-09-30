/**
 * Answers an API request. `rest` is what follows a route ending in `*`, still URL-encoded.
 */
type AppRoute = (request: Request, rest: string) => Promise<Response>;

/**
 * API routes by method and path, eg `POST /api/encode`. A path ending in `*` matches every path
 * that starts with what comes before it.
 */
type AppRoutes = Record<string, AppRoute>;

/**
 * Finds a request's route, and what follows a route ending in `*`.
 *
 * @param routes - The routes.
 * @param method - The request's method.
 * @param pathname - The request's path.
 */
function findRoute(routes: AppRoutes, method: string, pathname: string) {
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

export default findRoute;
export type { AppRoute, AppRoutes };
