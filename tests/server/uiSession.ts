import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { glob } from "tinyglobby";
import { startUiServer } from "../../src/server/index.js";
import { fixturePath } from "../fixtureManifest.js";

/**
 * A UI server on a temp folder, with a session cookie.
 */
type UiSession = Awaited<ReturnType<typeof startUiSession>>;

/**
 * Starts a UI server on a new temp folder holding copies of fixtures, beside a `secret.png`
 * outside it, and opens a session.
 *
 * @param files - The fixtures to copy, each optionally into a subfolder, eg `sub/a.png`.
 */
async function startUiSession(files: string[]) {
  const outside = await mkdtemp(path.join(tmpdir(), "wio ui é ü-"));
  const root = path.join(outside, "root");
  const secret = path.join(outside, "secret.png");

  await mkdir(root);
  await copyFile(fixturePath("icon-6x6.png"), secret);
  for (const file of files) {
    const target = path.join(root, file);

    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(fixturePath(path.basename(file)), target);
  }

  const server = await startUiServer({ root });
  const url = new URL(server.url);
  const exchange = await fetch(url, { redirect: "manual" });
  const cookie = exchange.headers.get("set-cookie")?.split(";")[0] ?? "";

  /**
   * Requests a path from the server with the session cookie.
   *
   * @param pathname - The path.
   * @param init - The request.
   */
  const api = (pathname: string, init: RequestInit = {}) =>
    fetch(new URL(pathname, url), {
      ...init,
      headers: { cookie, ...init.headers },
    });

  /**
   * Posts JSON to the API.
   *
   * @param pathname - The path.
   * @param body - The body, or text that isn't JSON.
   */
  const post = (pathname: string, body: unknown) =>
    api(pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  /**
   * Fetches a file by its ref.
   *
   * @param ref - The ref.
   */
  const image = (ref: string) => api(`/api/image/${encodeURIComponent(ref)}`);

  /**
   * Stops the server and removes the temp folder.
   */
  const close = async () => {
    await server.close();
    await rm(outside, { recursive: true, force: true });
  };

  return {
    server,
    url,
    exchange,
    cookie,
    root,
    outside,
    secret,
    api,
    post,
    image,
    close,
  };
}

/**
 * Reads a server-sent event stream to its end.
 *
 * @param response - The response.
 * @returns Each event's name, `message` when unnamed, and parsed data.
 */
async function readEvents(response: Response) {
  const text = await response.text();

  return text
    .split("\n\n")
    .filter((block) => block !== "")
    .map((block) => {
      const lines = block.split("\n");
      const name = lines
        .find((line) => line.startsWith("event: "))
        ?.slice("event: ".length);
      const data = lines
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .join("\n");

      return { name: name ?? "message", data: JSON.parse(data) as unknown };
    });
}

/**
 * Uploads a file with a unique name and returns the server's temp folder, found by that name,
 * since the API gives out refs rather than paths.
 *
 * @param api - Requests a path from the server with the session cookie.
 */
async function findSessionFolder(
  api: (pathname: string, init?: RequestInit) => Promise<Response>
) {
  const name = `probe-${randomUUID()}.png`;
  const form = new FormData();
  const bytes = await readFile(fixturePath("icon-6x6.png"));

  form.append("file", new Blob([bytes]), name);
  await api("/api/upload", { method: "POST", body: form });

  const [match] = await glob(`.wio-ui-*/uploads/*/${name}`, {
    cwd: tmpdir(),
    dot: true,
  });

  return path.join(tmpdir(), match?.split("/")[0] ?? "missing");
}

/**
 * Writes a text file, creating its folder.
 *
 * @param filePath - The file.
 * @param text - Its content.
 */
async function writeText(filePath: string, text: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text);
}

export { findSessionFolder, readEvents, startUiSession, writeText };
export type { UiSession };
