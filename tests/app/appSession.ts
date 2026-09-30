import { copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAppApi } from "../../src/app/index.js";
import { eventSchema } from "../../src/schema/contract.js";
import { fixturePath } from "../fixtureManifest.js";

const ORIGIN = "wio://app/";

/**
 * An app API with fixtures opened.
 */
type AppSession = Awaited<ReturnType<typeof startAppSession>>;

/**
 * Creates an app API, copies fixtures into a new temp folder, beside a `secret.png` that isn't
 * opened, and opens them.
 *
 * @param files - The fixtures to copy and open, each optionally into a subfolder, eg `sub/a.png`.
 */
async function startAppSession(files: string[]) {
  const outside = await realpath(
    await mkdtemp(path.join(tmpdir(), "wio app é ü-"))
  ); // as the app gives its paths, eg /private/var for macos's /var, or a windows short name in full
  const folder = path.join(outside, "images");
  const secret = path.join(outside, "secret.png");

  await mkdir(folder);
  await copyFile(fixturePath("icon-6x6.png"), secret);
  for (const file of files) {
    const target = path.join(folder, file);

    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(fixturePath(path.basename(file)), target);
  }

  const app = await createAppApi();

  /**
   * Opens files, and returns each one's ref.
   *
   * @param paths - The files.
   * @throws Error when one isn't opened.
   */
  const open = async (...paths: string[]) => {
    const opened = await app.open(paths);

    return opened.map((result) => {
      if ("error" in result) {
        throw new Error(result.error);
      }
      return result.ref;
    });
  };
  const opened = await open(...files.map((file) => path.join(folder, file)));
  const refs = new Map(files.map((file, index) => [file, opened[index]]));

  /**
   * Returns an opened fixture's ref.
   *
   * @param file - The fixture, as given to {@link startAppSession}.
   */
  const ref = (file: string) => {
    const found = refs.get(file);

    if (found === undefined) {
      throw new Error(`${file} wasn't opened`);
    }
    return found;
  };

  /**
   * Sends a request to the API.
   *
   * @param pathname - The path.
   * @param init - The request.
   */
  const api = (pathname: string, init: RequestInit = {}) =>
    app.handle(new Request(new URL(pathname, ORIGIN), init));

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
   * @param fileRef - The ref.
   */
  const image = (fileRef: string) =>
    api(`/api/image/${encodeURIComponent(fileRef)}`);

  /**
   * Fetches a file's bytes by its ref.
   *
   * @param fileRef - The ref.
   */
  const bytesOf = async (fileRef: string) =>
    Buffer.from(await (await image(fileRef)).arrayBuffer());

  /**
   * Closes the API and removes the temp folder.
   */
  const close = async () => {
    await app.close();
    await rm(outside, { recursive: true, force: true });
  };

  return {
    app,
    folder,
    outside,
    secret,
    open,
    ref,
    api,
    post,
    image,
    bytesOf,
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
 * Reads a run's event stream to its end.
 *
 * @param response - The response.
 * @returns The contract's events.
 */
async function readRun(response: Response) {
  const events = await readEvents(response);

  return events.flatMap((event) =>
    event.name === "message" ? [eventSchema.parse(event.data)] : []
  );
}

export { readEvents, readRun, startAppSession };
export type { AppSession };
