import path from "node:path";
import { generatePictureMarkup } from "../markup/index.js";
import findConflicts from "../pipeline/findConflicts.js";
import type {
  PipelineEvent,
  PipelineFileResult,
  PipelineMode,
  PipelineWarning,
} from "../pipeline/index.js";
import runBatch from "../pipeline/runBatch.js";
import type { BatchFailure } from "../pipeline/runBatch.js";
import ApiError from "./ApiError.js";
import { optimiseRequestSchema } from "./api.js";
import type { ServerContext } from "./context.js";
import type { ServerRoutes } from "./http.js";
import parseRequest from "./parseRequest.js";
import { refOf, resolveRef } from "./refs.js";
import type { ServerFolders } from "./refs.js";

const UPLOADS = "session/uploads/";

/**
 * An input to run: its real path, or its ref with why it can't be read.
 */
type RunInput = { path: string; missing?: string };

/**
 * Returns a function that replaces each of some paths in a text with its ref, in one pass, so
 * a ref already written can't be matched again.
 *
 * @param refs - The refs, by path.
 */
function relabeller(refs: ReadonlyMap<string, string>) {
  const paths = [...refs.keys()].toSorted(
    (first, second) => second.length - first.length // so a.png can't match inside a.png.png
  );
  const pattern = new RegExp(paths.map(RegExp.escape).join("|"), "g");

  return <Item extends Pick<PipelineWarning, "message">>(item: Item) => ({
    ...item,
    message:
      paths.length === 0
        ? item.message
        : item.message.replace(pattern, (match) => refs.get(match) ?? match),
  });
}

/**
 * Resolves a ref to run. One that names no image fails as its file, as a missing file does on
 * the command line, rather than stopping the whole run.
 *
 * @param ref - The ref.
 * @param folders - The server's folders.
 * @throws {@link ApiError} 400 when the ref is malformed.
 */
async function resolveInput(
  ref: string,
  folders: ServerFolders
): Promise<RunInput> {
  try {
    return { path: await resolveRef(ref, folders) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { path: ref, missing: error.message };
    }
    throw error;
  }
}

/**
 * Finds the inputs that fail before any work: those that can't be read, then those whose
 * outputs would clash where the CLI writes them, beside each input, or in the folder served for
 * an upload, where Write puts it.
 *
 * @param inputs - The inputs, in order.
 * @param refs - Their refs.
 * @param root - The folder served.
 * @param mode - The run's mode.
 */
async function failuresOf(
  inputs: RunInput[],
  refs: string[],
  root: string,
  mode: PipelineMode
) {
  const failures = new Map<number, BatchFailure>();
  const present = inputs.flatMap((input, index) => {
    if (input.missing !== undefined) {
      failures.set(index, { code: "E_READ", message: input.missing });
      return [];
    }
    return [
      {
        index,
        path: input.path,
        outDir: refs[index]?.startsWith(UPLOADS) ? root : undefined,
      },
    ];
  });
  const conflicts = await findConflicts(present, mode);

  for (const [position, message] of conflicts) {
    const index = present[position]?.index ?? position;

    failures.set(index, { code: "E_OUTPUT_CONFLICT", message });
  }
  return failures;
}

/**
 * Generates the markup that `wio --to suite --markup` would print for a file, run in the folder
 * served: its outputs beside it, at URLs relative to that folder, or an upload's own.
 *
 * @param file - The file's result.
 * @param inputRef - The input's ref.
 * @param folders - The server's folders.
 */
function markupAsWritten(
  file: PipelineFileResult,
  inputRef: string,
  folders: ServerFolders
) {
  const inputFolder = path.dirname(file.input);
  const asWritten = {
    ...file,
    outputs: file.outputs.map((output) => ({
      ...output,
      path: path.join(inputFolder, path.basename(output.path)),
    })),
  };
  const root = inputRef.startsWith("root/") ? folders.root : inputFolder;

  return generatePictureMarkup(asWritten, { root });
}

/**
 * Describes a finished file with refs in place of paths, in its fields and its messages.
 *
 * @param file - The file's result.
 * @param inputRefs - Each input's ref, by path.
 * @param folders - The server's folders.
 * @param withMarkup - Whether to add the file's markup.
 */
function presentFile(
  file: PipelineFileResult,
  inputRefs: Map<string, string>,
  folders: ServerFolders,
  withMarkup: boolean
): PipelineFileResult {
  const inputRef = inputRefs.get(file.input) ?? file.input;
  const markup = withMarkup
    ? markupAsWritten(file, inputRef, folders)
    : undefined;
  const refs = new Map(
    file.error?.code === "E_OUTPUT_CONFLICT"
      ? inputRefs // only a clash's message names another input
      : [[file.input, inputRef]]
  );
  const outputs = file.outputs.map((output) => {
    const ref = refOf(output.path, folders);

    refs.set(output.path, ref);
    return { ...output, path: ref };
  });
  const relabel = relabeller(refs);

  return {
    ...file,
    input: inputRef,
    outputs,
    warnings: file.warnings.map(relabel),
    ...(file.error === undefined ? {} : { error: relabel(file.error) }),
    ...(markup === undefined ? {} : { markup }),
  };
}

/**
 * Describes an event with refs in place of paths.
 *
 * @param event - The event.
 * @param inputRefs - Each input's ref, by path.
 * @param folders - The server's folders.
 * @param withMarkup - Whether to add each file's markup.
 */
function presentEvent(
  event: PipelineEvent,
  inputRefs: Map<string, string>,
  folders: ServerFolders,
  withMarkup: boolean
): PipelineEvent {
  if (event.type === "file-start") {
    return { ...event, input: inputRefs.get(event.input) ?? event.input };
  }
  return event.type === "file-done"
    ? {
        ...event,
        file: presentFile(event.file, inputRefs, folders, withMarkup),
      }
    : event;
}

/**
 * Creates the route that runs a batch into a new folder of the server's temp folder, streaming
 * its events. Files fail as the copied command would fail them: one that can't be read, and one
 * whose outputs would clash where the CLI writes them. A new run stops the one in progress, and
 * closing the stream stops it too.
 *
 * @param context - The server's state.
 */
function createRunRoute(context: ServerContext): ServerRoutes {
  const optimise = async (raw: Request) => {
    const request = await parseRequest(raw, optimiseRequestSchema);
    const inputs = await Promise.all(
      request.files.map((ref) => resolveInput(ref, context.folders))
    );

    while (context.run !== undefined) {
      context.run.stop(); // eg the one stopped from the page, whose stream may not have closed yet
      await context.run.finished;
    }

    const stopper = new AbortController();
    const finished = Promise.withResolvers<void>();
    const signal = AbortSignal.any([
      context.stopped,
      raw.signal,
      stopper.signal,
    ]);

    context.run = {
      stop: () => {
        stopper.abort();
      },
      finished: finished.promise,
    }; // no await since the loop, so two requests can't both claim it
    const folder = context.nextFolder("runs");
    const inputRefs = new Map(
      inputs.map((input, index) => [
        input.path,
        request.files[index] ?? input.path,
      ])
    );
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    const send = (data: unknown, event?: string) => {
      const text = `${event === undefined ? "" : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`;

      writer.write(encoder.encode(text)).catch(() => undefined); // the page went away, which stops the run too
    };

    void (async () => {
      try {
        const options = { to: request.to, target: request.target };

        await runBatch(
          inputs.map((input, index) => ({
            path: input.path,
            options: { ...options, outDir: path.join(folder, String(index)) }, // each input's own folder, so no two outputs clash
          })),
          options,
          {
            signal,
            onEvent: (event) => {
              send(
                presentEvent(
                  event,
                  inputRefs,
                  context.folders,
                  request.to === "suite" // as the cli allows --markup only with suite
                )
              );
            },
          },
          (settings) =>
            failuresOf(inputs, request.files, context.folders.root, settings.to)
        );
      } catch (error) {
        if (!signal.aborted) {
          send(
            { error: error instanceof Error ? error.message : String(error) },
            "error"
          );
        }
      } finally {
        context.run = undefined;
        finished.resolve();
        await writer.close().catch(() => undefined);
      }
    })();
    return new Response(stream.readable, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  };

  return { "POST /api/optimise": optimise };
}

export default createRunRoute;
