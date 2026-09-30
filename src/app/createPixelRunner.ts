import createProcessSlot from "../pipeline/processSlot.js";
import { isSourceRun } from "../runtime/index.js";
import ApiError from "./ApiError.js";
import { runPixelJob } from "./pixelJobs.js";
import type { PixelJob, PixelReply } from "./pixelJobs.js";

/**
 * Runs the app API's {@link PixelJob}s one at a time, off the thread that answers requests.
 */
type PixelRunner = {
  /** Searches a format for a source's smallest output that reaches a target, and writes it, resolving with its size and score. */
  search: (
    job: Omit<Extract<PixelJob, { type: "search" }>, "type">
  ) => Promise<Extract<PixelReply, { type: "searched" }>>;
  /** Draws a diff map and writes it. */
  diff: (
    job: Omit<Extract<PixelJob, { type: "diff" }>, "type">
  ) => Promise<void>;
  /** Stops the child process, and fails every job still queued. */
  close: () => Promise<void>;
};

/**
 * Turns a failed reply into an {@link ApiError}: 422 when the image was the problem, else 500.
 *
 * @param reply - The reply.
 */
function assertSucceeded<Reply extends PixelReply>(
  reply: Reply
): asserts reply is Exclude<Reply, { type: "failed" }> {
  if (reply.type === "failed") {
    throw new ApiError(
      reply.code === undefined ? 500 : 422,
      reply.message,
      reply.code
    );
  }
}

/**
 * Creates a {@link PixelRunner}: in a child process when running the build, since
 * scoring blocks its thread for about a second per megapixel, or on the calling thread when
 * running the TypeScript sources, whose `.js` imports a child can't load.
 */
function createPixelRunner(): PixelRunner {
  const fromSource = isSourceRun(import.meta.url);
  const slot = createProcessSlot(new URL("./pixelWorker.js", import.meta.url));
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;

  const inChild = async (job: PixelJob): Promise<PixelReply> => {
    const outcome = await slot.send<PixelReply>(job);

    return outcome.type === "reply"
      ? outcome.reply
      : {
          type: "failed",
          message: `The pixel process stopped: ${outcome.detail}`,
        };
  };
  const run = (job: PixelJob) => {
    const reply = queue.then((): Promise<PixelReply> | PixelReply => {
      if (closed) {
        return { type: "failed", message: "The app is stopping" }; // rather than start another child
      }
      return fromSource ? runPixelJob(job) : inChild(job);
    });

    queue = reply; // replies never reject
    return reply;
  };

  return {
    search: async (job) => {
      const reply = await run({ type: "search", ...job });

      assertSucceeded(reply);
      if (reply.type !== "searched") {
        throw new Error(`Expected a search's reply, got ${reply.type}`);
      }
      return reply;
    },
    diff: async (job) => {
      const reply = await run({ type: "diff", ...job });

      assertSucceeded(reply);
    },
    close: async () => {
      closed = true;
      await slot.close();
      await queue; // the job under way settles, and the rest fail without starting
    },
  };
}

export default createPixelRunner;
export type { PixelRunner };
