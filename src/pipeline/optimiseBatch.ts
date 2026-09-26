import findConflicts from "./findConflicts.js";
import runBatch from "./runBatch.js";
import type { BatchContext } from "./runBatch.js";
import type {
  PipelineBatchInput,
  PipelineOptions,
  PipelineRunResult,
} from "./types.js";

/**
 * Optimises many image files with {@link optimiseFile}'s rules, several at once, each on a worker
 * thread of its own.
 *
 * Before any work, an input fails with `E_OUTPUT_CONFLICT` when one of its outputs could land on
 * another input, or on an earlier input's outputs (such as `photo.png` and `photo.jpg` both
 * writing `photo.webp`), judging formats from the files' bytes. An
 * unexpected error in one file fails it with `E_INTERNAL` rather than stopping the run. Events
 * report progress: `run-start`, then `file-start` and `file-done` for each file, then `run-done`.
 *
 * @param inputs - The image paths, each optionally with its own output folder.
 * @param options - What to write, and where, as for {@link optimiseFile}.
 * @param context - `signal` aborts the run: it rejects with the signal's reason once every file
 * in progress has stopped and cleaned up its temp files. `onEvent` receives each event.
 * `concurrency` is how many files run at once; it defaults to one fewer than the CPUs, capped at
 * one per 4 GiB of memory, because scoring a very large image takes that much.
 * @returns Every file's result in input order, with totals and the versions used.
 * @throws RangeError when an option or the concurrency is invalid.
 *
 * @example
 * ```ts
 * import { optimiseBatch } from "web-image-optimiser";
 *
 * const result = await optimiseBatch(["hero.jpg", "logo.png"], { to: "suite", outDir: "web" }, {
 *   onEvent: (event) => {
 *     if (event.type === "file-done") console.log(event.file.input, event.file.status);
 *   },
 * });
 * console.log(result.totals);
 * ```
 */
async function optimiseBatch(
  inputs: PipelineBatchInput[],
  options: PipelineOptions = {},
  context: BatchContext = {}
): Promise<PipelineRunResult> {
  const tasks = inputs.map((input) =>
    typeof input === "string"
      ? { path: input, options }
      : {
          path: input.path,
          options: { ...options, outDir: input.outDir ?? options.outDir },
        }
  );

  return runBatch(tasks, options, context, async (settings) => {
    const conflicts = await findConflicts(
      tasks.map((task) => ({ path: task.path, outDir: task.options.outDir })),
      settings.to
    );

    return new Map(
      [...conflicts].map(([index, message]) => [
        index,
        { code: "E_OUTPUT_CONFLICT", message },
      ])
    );
  });
}

export default optimiseBatch;
