import path from "node:path";
import type {
  PipelineEvent,
  PipelineFileResult,
  PipelineWarning,
} from "../pipeline/index.js";
import runBatch from "../pipeline/runBatch.js";
import type { BatchFailure } from "../pipeline/runBatch.js";
import ApiError from "./ApiError.js";
import { optimiseRequestSchema } from "./api.js";
import type { AppContext } from "./context.js";
import type { AppRoutes } from "./findRoute.js";
import { parseRequest } from "./parseRequest.js";
import { refOf, resolveRef } from "./refs.js";
import type { AppRefs } from "./refs.js";
import resolveOptions from "./resolveOptions.js";

/**
 * An input to run: its ref, and its real path, or the ref again with why it can't be read.
 */
type RunInput = { ref: string; path: string; missing?: string };

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
    message: item.message.replace(pattern, (match) => refs.get(match) ?? match),
  });
}

/**
 * Resolves an opened file's ref to run. One that names no image fails as its file, as a missing
 * file does on the command line, rather than stopping the whole run.
 *
 * @param ref - The ref.
 * @param refs - Where refs lead.
 * @throws {@link ApiError} 400 when the ref is malformed or isn't an opened file's.
 */
async function resolveInput(ref: string, refs: AppRefs): Promise<RunInput> {
  try {
    return { ref, path: await resolveRef(ref, refs, ["file"]) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { ref, path: ref, missing: error.message };
    }
    throw error;
  }
}

/**
 * Describes a finished file with refs in place of paths, in its fields and its messages.
 *
 * @param file - The file's result.
 * @param inputRef - The input's ref.
 * @param session - The API's temp folder.
 */
function presentFile(
  file: PipelineFileResult,
  inputRef: string,
  session: string
): PipelineFileResult {
  const refs = new Map([[file.input, inputRef]]);
  const outputs = file.outputs.map((output) => {
    const ref = refOf(output.path, session);

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
  };
}

/**
 * Describes an event with refs in place of paths.
 *
 * @param event - The event.
 * @param inputRefs - Each input's ref, by path.
 * @param session - The API's temp folder.
 */
function presentEvent(
  event: PipelineEvent,
  inputRefs: Map<string, string>,
  session: string
): PipelineEvent {
  if (event.type === "file-start") {
    return { ...event, input: inputRefs.get(event.input) ?? event.input };
  }
  if (event.type === "file-done") {
    const inputRef = inputRefs.get(event.file.input) ?? event.file.input;

    return { ...event, file: presentFile(event.file, inputRef, session) };
  }
  return event;
}

/**
 * Creates the route that runs opened files in `suite` mode into a new folder of the API's temp
 * folder, each input in a folder of its own, streaming its events. A file that can't be read
 * fails as its own, as on the command line. A new run stops the one in progress, and closing the
 * stream stops it too.
 *
 * @param context - The API's state.
 */
function createRunRoute(context: AppContext): AppRoutes {
  const optimise = async (raw: Request) => {
    const { files, ...settings } = await parseRequest(
      raw,
      optimiseRequestSchema
    );
    const options = { ...settings, to: "suite" } as const;

    resolveOptions(options); // refused here, rather than as the run's error event

    const inputs = await Promise.all(
      files.map((ref) => resolveInput(ref, context.refs))
    );
    const failures = new Map<number, BatchFailure>(
      inputs.flatMap((input, index) =>
        input.missing === undefined
          ? []
          : [[index, { code: "E_READ", message: input.missing }]]
      )
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
    const inputRefs = new Map(inputs.map((input) => [input.path, input.ref]));
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    const send = (data: unknown, event?: string) => {
      const text = `${event === undefined ? "" : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`;

      writer.write(encoder.encode(text)).catch(() => undefined); // the page went away, which stops the run too
    };

    void (async () => {
      try {
        await runBatch(
          inputs.map((input, index) => ({
            path: input.path,
            options: { ...options, outDir: path.join(folder, String(index)) }, // each input's own folder, so no two outputs clash
          })),
          options,
          {
            signal,
            onEvent: (event) => {
              send(presentEvent(event, inputRefs, context.refs.session));
            },
          },
          () => Promise.resolve(failures)
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
