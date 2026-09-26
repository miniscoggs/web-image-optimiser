import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiErrorSchema } from "../../src/server/api.js";
import { startUiSession } from "./uiSession.js";
import type { UiSession } from "./uiSession.js";

let session: UiSession;

beforeAll(async () => {
  session = await startUiSession(["gradient.png"]);
});
afterAll(async () => {
  await session.close();
});

describe("the UI server's session", () => {
  it("listens on 127.0.0.1 with a token in the address", () => {
    expect(session.url.hostname).toBe("127.0.0.1");
    expect(session.url.pathname).toBe("/");
    expect(session.url.searchParams.get("token")).toMatch(
      /^[\w-]{43}$/ // 32 random bytes, base64url
    );
  });

  it("swaps the token for a strict, HTTP-only cookie named for its port, on a page that moves on to /", async () => {
    const setCookie = session.exchange.headers.get("set-cookie") ?? "";

    expect(session.exchange.status).toBe(200);
    expect(session.exchange.headers.get("content-type")).toContain("text/html");
    expect(await session.exchange.text()).toContain(
      '<meta http-equiv="refresh" content="0; url=/">'
    );
    expect(setCookie).toMatch(new RegExp(`^wio-${session.url.port}=[\\w-]+;`));
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it.each([
    ["no cookie", () => undefined],
    ["a wrong token", (name: string) => `${name}=nope`],
    [
      "the token under another port's name",
      (_name: string, token: string) => `wio-1=${token}`,
    ],
  ])("refuses an API request with %s", async (_label, makeCookie) => {
    const token = session.url.searchParams.get("token") ?? "";
    const cookie = makeCookie(`wio-${session.url.port}`, token);
    const response = await fetch(new URL("/api/files", session.url), {
      headers: cookie === undefined ? {} : { cookie },
    });

    expect(response.status).toBe(401);
    expect(apiErrorSchema.parse(await response.json()).error).toContain(
      "session token"
    );
  });

  it("takes the token from the page wio ui opens, which counts as another site", async () => {
    const response = await fetch(session.url, {
      headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      `wio-${session.url.port}=`
    );
  });

  it("refuses a wrong token in the address, and a page without the cookie", async () => {
    const wrong = await fetch(new URL("/?token=nope", session.url), {
      redirect: "manual",
    });
    const page = await fetch(new URL("/", session.url));

    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect(page.status).toBe(401);
    expect(await page.text()).toContain("open the address that wio ui printed");
  });

  it.each([
    ["another origin", { origin: "https://example.com" }],
    ["another port of 127.0.0.1", { origin: "http://127.0.0.1:1" }],
    ["a same-site page", { "sec-fetch-site": "same-site" }],
    ["a cross-site page", { "sec-fetch-site": "cross-site" }],
  ])(
    "refuses a request from %s, with the cookie, and sends no CORS headers",
    async (_label, headers) => {
      const response = await session.api("/api/files", { headers });

      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(apiErrorSchema.parse(await response.json()).error).toContain(
        "own page"
      );
    }
  );

  it("answers the page's own requests", async () => {
    const response = await session.api("/api/files", {
      headers: { origin: session.url.origin, "sec-fetch-site": "same-origin" },
    });

    expect(response.status).toBe(200);
  });

  it("sends hardening headers", async () => {
    const response = await session.api("/api/files");

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'"
    );
  });

  it("answers an unknown endpoint with 404, and says when the UI isn't built", async () => {
    const endpoint = await session.api("/api/nothing");
    const page = await session.api("/"); // the sources have no built ui

    expect(endpoint.status).toBe(404);
    expect(apiErrorSchema.parse(await endpoint.json()).error).toBe(
      "No such endpoint"
    );
    expect(page.status).toBe(404);
    expect(await page.text()).toContain("npm run build");
  });
});
