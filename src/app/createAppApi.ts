import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ApiError from "./ApiError.js";
import type {
  AppOpenedFile,
  AppSaveOutputRefs,
  AppSaveSuites,
  AppSavedOutput,
  AppSavedSuiteFile,
} from "./api.js";
import APP_HEADERS from "./appHeaders.js";
import type { AppContext } from "./context.js";
import createPixelRunner from "./createPixelRunner.js";
import describeFailure from "./describeFailure.js";
import findRoute from "./findRoute.js";
import createImageRoute from "./imageRoute.js";
import createOpenedFiles from "./openedFiles.js";
import createPixelRoutes from "./pixelRoutes.js";
import createRightsRoute from "./rightsRoute.js";
import createRunRoute from "./runRoute.js";
import { saveFolder, saveOutput, savePath, saveSuites } from "./save.js";
import type { AppSaveOutputRequest } from "./save.js";

/**
 * The in-process API the desktop app serves to its page, from {@link createAppApi}. The page
 * reaches only `handle`, which never takes or gives an absolute path; the other calls are for
 * the main process, with the paths its OS dialogs chose.
 */
type AppApi = {
  /** Answers a request under `/api/`. It never rejects: a failure is an error response. */
  handle: (request: Request) => Promise<Response>;
  /** Opens files by their paths, so the page can use them by ref; it never rejects for a file that isn't an image, but says why. */
  open: (paths: string[]) => Promise<AppOpenedFile[]>;
  /** Returns where a pane's save dialog starts: the original's folder, with a free name for the output. */
  savePath: (refs: AppSaveOutputRefs) => Promise<string>;
  /** Returns where Save suite's folder picker starts: the first opened file's folder. */
  saveFolder: (suites: AppSaveSuites) => Promise<string>;
  /** Saves an output where the save dialog chose. */
  saveOutput: (request: AppSaveOutputRequest) => Promise<AppSavedOutput>;
  /** Saves opened files' outputs into a folder, with free names. */
  saveSuites: (
    suites: AppSaveSuites,
    folder: string
  ) => Promise<AppSavedSuiteFile[]>;
  /** Stops a run in progress, waits for the requests under way, and removes the temp folder. Requests after it get 503. */
  close: () => Promise<void>;
};

/**
 * Turns a failure into its response, as {@link describeFailure} describes it.
 *
 * @param error - What was thrown.
 */
function failureOf(error: unknown) {
  const { status, body } = describeFailure(error);

  return Response.json(body, { status });
}

/**
 * Creates the API the desktop app's page talks to, as web `Request`s and `Response`s, with no
 * network port. It reads only the files the main process opened and a temp folder of its own,
 * where runs, searches, rights and diff maps go. It writes only into that temp folder, which
 * `close` removes, and, through the save calls, where the main process's dialogs chose. Every
 * response gets hardening headers.
 */
async function createAppApi(): Promise<AppApi> {
  const created = await mkdtemp(path.join(tmpdir(), ".wio-app-"));
  const session = await realpath(created); // refs are checked against real paths
  const controller = new AbortController();
  const opened = createOpenedFiles();
  let folders = 0;
  const context: AppContext = {
    refs: { opened, session },
    stopped: controller.signal,
    pixels: createPixelRunner(),
    run: undefined,
    nextFolder: (kind) => path.join(session, kind, String((folders += 1))),
    searches: new Map(),
    diffs: new Map(),
  };
  const routes = {
    ...createImageRoute(context),
    ...createRunRoute(context),
    ...createPixelRoutes(context),
    ...createRightsRoute(context),
  };
  const inFlight = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;

  const assertOpen = () => {
    if (closing !== undefined) {
      throw new ApiError(503, "The app is closing");
    }
  };
  const track = <Value>(work: () => Promise<Value>) => {
    const promise = work();
    const settled = promise.then(
      () => undefined,
      () => undefined
    );

    inFlight.add(settled);
    void settled.then(() => inFlight.delete(settled));
    return promise;
  };
  const route = async (request: Request) => {
    assertOpen();

    const found = findRoute(
      routes,
      request.method,
      new URL(request.url).pathname
    );

    if (found === undefined) {
      throw new ApiError(404, "No such endpoint");
    }
    return found.route(request, found.rest);
  };
  const handle = async (request: Request) => {
    const response = await route(request).catch(failureOf);

    for (const [name, value] of Object.entries(APP_HEADERS)) {
      if (!response.headers.has(name)) {
        response.headers.set(name, value);
      }
    }
    return response;
  };
  const close = async () => {
    controller.abort(); // stops a run
    await context.pixels.close();
    await Promise.allSettled(inFlight);
    await context.run?.finished; // a run's stream outlives its request
    await rm(session, { recursive: true, force: true });
  };

  return {
    handle: (request) => track(() => handle(request)),
    open: (paths) =>
      track(async () => {
        assertOpen();
        return opened.open(paths);
      }),
    savePath: (refs) =>
      track(async () => {
        assertOpen();
        return savePath(refs, context.refs);
      }),
    saveFolder: (suites) =>
      track(async () => {
        assertOpen();
        return saveFolder(suites, context.refs);
      }),
    saveOutput: (request) =>
      track(async () => {
        assertOpen();
        return saveOutput(request, context.refs);
      }),
    saveSuites: (suites, folder) =>
      track(async () => {
        assertOpen();
        return saveSuites(suites, folder, context.refs);
      }),
    close: () => (closing ??= close()),
  };
}

export default createAppApi;
export type { AppApi };
