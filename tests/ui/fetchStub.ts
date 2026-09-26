import { vi } from "vitest";

// the ui talks only to the server's api, so its component tests stub fetch per test

/**
 * Returns a JSON response.
 *
 * @param body - The body.
 * @param status - The status.
 */
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Stubs `fetch` with one that answers each API path from a handler, which gets the request's
 * JSON body. Any other path gets a 404.
 *
 * @param routes - The handlers, by path.
 * @returns The stub, to check its calls.
 */
function stubFetch(routes: Record<string, (body: unknown) => Response>) {
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const route = typeof input === "string" ? routes[input] : undefined; // the ui fetches paths
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

    return Promise.resolve(
      route === undefined
        ? jsonResponse({ error: "No such endpoint" }, 404)
        : route(body)
    );
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export { jsonResponse, stubFetch };
