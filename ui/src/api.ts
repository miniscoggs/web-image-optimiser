import type {
  PipelineEvent,
  PipelineMode,
  PipelineTargetPreset,
} from "../../src/pipeline/types.js";
import type {
  PixelFormat,
  ServerDiffResponse,
  ServerEncodeResponse,
  ServerFilesResponse,
  ServerUploadResponse,
  ServerWriteResponse,
} from "../../src/server/api.js";
import readEvents from "./readEvents.js";

// the session cookie rides along with every same-origin request

/**
 * The options a run in the UI takes, which are the CLI's `--to` and `--target`.
 */
type RunOptions = { to: PipelineMode; target: PipelineTargetPreset | number };

/**
 * What a write may replace, as the CLI's flags: the original with `inPlace`, and another
 * existing file with `overwrite`.
 */
type WriteReplacing = { inPlace?: boolean; overwrite?: boolean };

/**
 * Returns an error's message, for showing to the person.
 *
 * @param error - What was thrown.
 */
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turns a failed response into an error with the server's message.
 *
 * @param response - The response.
 */
async function failure(response: Response) {
  const body = (await response.json().catch(() => undefined)) as
    { error?: string } | undefined;

  return new Error(body?.error ?? `The server answered ${response.status}`);
}

/**
 * Makes a request and returns its JSON body.
 *
 * @param path - The API path.
 * @param init - The request.
 */
async function request<ResponseBody>(path: string, init?: RequestInit) {
  const response = await fetch(path, init);

  if (!response.ok) {
    throw await failure(response);
  }
  return (await response.json()) as ResponseBody;
}

/**
 * Posts JSON and returns the response's JSON body.
 *
 * @param path - The API path.
 * @param body - The request's body.
 */
function postJson<ResponseBody>(path: string, body: unknown) {
  return request<ResponseBody>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Lists the folder served's images, then the uploads.
 */
function listFiles() {
  return request<ServerFilesResponse>("/api/files");
}

/**
 * Uploads files into the server's temp folder.
 *
 * @param files - The files.
 * @returns The files as stored.
 */
async function uploadFiles(files: File[]) {
  const form = new FormData();

  for (const file of files) {
    form.append("file", file);
  }

  const body = await request<ServerUploadResponse>("/api/upload", {
    method: "POST",
    body: form,
  });

  return body.files;
}

/**
 * Runs files into the server's temp folder, yielding the run's events as they arrive.
 *
 * @param refs - The files.
 * @param options - The mode and target.
 * @param signal - Stops the run.
 */
async function* runFiles(
  refs: string[],
  options: RunOptions,
  signal: AbortSignal
): AsyncGenerator<PipelineEvent> {
  const response = await fetch("/api/optimise", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: refs, ...options }),
    signal,
  });

  if (!response.ok || response.body === null) {
    throw await failure(response);
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
 * Draws where a candidate differs from its original, into the server's temp folder.
 *
 * @param original - The original's ref.
 * @param candidate - The candidate's ref, an image of the same size.
 * @returns The diff map's ref, a PNG.
 */
async function diffImage(original: string, candidate: string) {
  const body = await postJson<ServerDiffResponse>("/api/diff", {
    original,
    candidate,
  });

  return body.ref;
}

/**
 * Re-encodes a file at a quality into the server's temp folder, and scores it against the file.
 *
 * @param file - The file's ref.
 * @param format - The format, a lossy one.
 * @param quality - The quality.
 */
function encodeImage(file: string, format: PixelFormat, quality: number) {
  return postJson<ServerEncodeResponse>("/api/encode", {
    file,
    format,
    quality,
  });
}

/**
 * Saves a run's output or a re-encode into the folder served, beside its original.
 *
 * @param original - The original's ref.
 * @param candidate - The output's or re-encode's ref.
 * @param replacing - What the write may replace.
 * @returns Where it goes, and whether it was written or what blocked it.
 */
function writeImage(
  original: string,
  candidate: string,
  replacing: WriteReplacing = {}
) {
  return postJson<ServerWriteResponse>("/api/write", {
    original,
    candidate,
    ...replacing,
  });
}

export {
  diffImage,
  encodeImage,
  listFiles,
  messageOf,
  runFiles,
  uploadFiles,
  writeImage,
};
export type { RunOptions, WriteReplacing };
