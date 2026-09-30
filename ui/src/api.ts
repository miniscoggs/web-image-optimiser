import type {
  AppDiffResponse,
  AppRightsResponse,
  AppSearchResponse,
  PixelFormat,
} from "../../src/app/api.js";
import type {
  PipelineEvent,
  PipelineRightsOptions,
  PipelineTargetPreset,
} from "../../src/pipeline/types.js";
import readEvents from "./readEvents.js";

// what this page calls on the app api: runs, target searches, diff maps and rights rewrites; opening and saving
// go through the desktop bridge

/**
 * What a run and a metadata rewrite take: the CLI's `--target`, `--max-width`, `--strip-all` and
 * rights flags. A run is always in `suite` mode, which the API assumes.
 */
type RunSettings = {
  target: PipelineTargetPreset | number;
  maxWidth?: number;
  stripAll?: boolean;
  rights?: PipelineRightsOptions;
};

/**
 * A finished output to rewrite with other metadata: its original's ref, and its own.
 */
type RightsCandidate = { original: string; candidate: string };

/**
 * Returns an error's message, for showing to the person.
 *
 * @param error - What was thrown.
 */
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turns a failed response into an error with the API's message.
 *
 * @param response - The response.
 */
async function failure(response: Response) {
  const body = (await response.json().catch(() => undefined)) as
    { error?: string } | undefined;

  return new Error(body?.error ?? `The app answered ${response.status}`);
}

/**
 * Posts JSON and returns the response.
 *
 * @param path - The API path.
 * @param body - The request's body.
 * @param signal - Stops the request.
 */
async function postJson(path: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw await failure(response);
  }
  return response;
}

/**
 * Runs opened files in `suite` mode into the app's temp folder, yielding the run's events as
 * they arrive.
 *
 * @param refs - The opened files' refs.
 * @param settings - The run's target, width and metadata options.
 * @param signal - Stops the run.
 */
async function* runFiles(
  refs: string[],
  settings: RunSettings,
  signal: AbortSignal
): AsyncGenerator<PipelineEvent> {
  const response = await postJson(
    "/api/optimise",
    { files: refs, ...settings },
    signal
  );

  if (response.body === null) {
    throw new Error("The app sent no events");
  }
  for await (const message of readEvents(response.body)) {
    const data = JSON.parse(message.data) as unknown;

    if (message.event === "error") {
      throw new Error((data as { error: string }).error);
    }
    yield data as PipelineEvent;
  }
}

/**
 * Draws where a candidate differs from its original, into the app's temp folder.
 *
 * @param original - The original's ref.
 * @param candidate - The candidate's ref, an image of the same size.
 * @param maxWidth - The width the candidate was made at, when the run capped it.
 * @returns The diff map's ref, a PNG.
 */
async function diffImage(
  original: string,
  candidate: string,
  maxWidth?: number
) {
  const response = await postJson("/api/diff", {
    original,
    candidate,
    ...(maxWidth === undefined ? {} : { maxWidth }),
  });

  return ((await response.json()) as AppDiffResponse).ref;
}

/**
 * Finds a file's smallest output in a format that reaches a target, as a suite would choose it.
 *
 * @param file - The opened file's ref.
 * @param format - The format to search in.
 * @param settings - The search's target, width and metadata options.
 */
async function searchTarget(
  file: string,
  format: PixelFormat,
  settings: RunSettings
) {
  const response = await postJson("/api/search", {
    file,
    format,
    ...settings,
  });

  return (await response.json()) as AppSearchResponse;
}

/**
 * Writes the rights fields into outputs again, without re-encoding them.
 *
 * @param candidates - The outputs, with their originals.
 * @param metadata - What happens to the metadata now.
 * @returns Each output as rewritten, in order.
 */
async function rewriteRights(
  candidates: RightsCandidate[],
  metadata: Pick<RunSettings, "stripAll" | "rights">
) {
  const response = await postJson("/api/rights", { candidates, ...metadata });

  return ((await response.json()) as AppRightsResponse).candidates;
}

export { diffImage, messageOf, rewriteRights, runFiles, searchTarget };
export type { RunSettings };
