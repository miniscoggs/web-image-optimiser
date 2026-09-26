import createWorkerSlot from "../pipeline/workerSlot.js";
import ApiError from "./ApiError.js";
import { runPixelJob } from "./pixelJobs.js";
import type { PixelJob, PixelReply } from "./pixelJobs.js";

/**
 * Runs the UI server's {@link PixelJob}s one at a time, off the thread that serves requests.
 */
type PixelRunner = {
  /** Re-encodes a source at a quality, scores it and writes it, resolving with its size and score. */
  encode: (
    job: Omit<Extract<PixelJob, { type: "encode" }>, "type">
  ) => Promise<Extract<PixelReply, { type: "encoded" }>>;
  /** Draws a diff map and writes it. */
  diff: (
    job: Omit<Extract<PixelJob, { type: "diff" }>, "type">
  ) => Promise<void>;
  /** Stops the worker, and fails every job still queued. */
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
 * Creates a {@link PixelRunner}: on a worker thread when running the built package, since
 * scoring blocks its thread for about a second per megapixel, or on the calling thread when
 * running the TypeScript sources, whose `.js` imports a worker can't load.
 */
function createPixelRunner(): PixelRunner {
  const fromSource = new URL(import.meta.url).pathname.endsWith(".ts");
  const slot = createWorkerSlot(new URL("./pixelWorker.js", import.meta.url));
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;

  const inWorker = async (job: PixelJob): Promise<PixelReply> => {
    const outcome = await slot.send<PixelReply>(job);

    return outcome.type === "reply"
      ? outcome.reply
      : { type: "failed", message: `The worker stopped: ${outcome.detail}` };
  };
  const run = (job: PixelJob) => {
    const reply = queue.then((): Promise<PixelReply> | PixelReply => {
      if (closed) {
        return { type: "failed", message: "The wio UI server is stopping" }; // rather than start another worker
      }
      return fromSource ? runPixelJob(job) : inWorker(job);
    });

    queue = reply; // replies never reject
    return reply;
  };

  return {
    encode: async (job) => {
      const reply = await run({ type: "encode", ...job });

      assertSucceeded(reply);
      if (reply.type !== "encoded") {
        throw new Error(`Expected an encoded reply, got ${reply.type}`);
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
