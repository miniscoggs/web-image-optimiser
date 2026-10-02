import { Worker } from "node:worker_threads";

const IDLE_MS = 30_000; // a new thread's first score takes about 15% longer, compiling the wasm and growing its memory

/**
 * Two images for SSIMULACRA 2: 8-bit sRGB pixels in RGB order, `width * height * 3` bytes each.
 */
type ScorePair = {
  reference: Uint8Array;
  distorted: Uint8Array;
  width: number;
  height: number;
};

/**
 * A scoring thread's reply to a pair: its score, or the error scoring it threw.
 */
type ScoreReply =
  { score: number } | { error: { name: string; message: string } };

/**
 * Scores pairs on worker threads, each with a WASM scorer of its own, in the order they arrive,
 * apart from pairs scored ahead of need, which wait behind the rest.
 */
type MetricsScorePool = {
  /** How many threads it scores on. */
  size: number;
  /**
   * Scores a pair on the first free thread. The threads take the memory `transfer` lists
   * rather than copying it, which leaves it unusable here. A pair still waiting for a thread
   * when `signal` aborts is dropped, rejecting with its reason, and one being scored finishes.
   * While `speculative` returns true, the pair waits behind every pair it doesn't; it is read
   * each time a thread frees, as a pair can become needed while it waits.
   */
  score: (pair: ScorePair, options?: ScorePoolOptions) => Promise<number>;
  /** Terminates the threads, failing the pairs waiting or being scored. */
  close: () => Promise<void>;
};

/**
 * How {@link MetricsScorePool}'s `score` handles a pair.
 */
type ScorePoolOptions = {
  signal?: AbortSignal;
  transfer?: ArrayBuffer[];
  speculative?: () => boolean;
};

/**
 * A pair waiting for a thread or being scored, and how to settle its promise.
 */
type ScoreJob = {
  pair: ScorePair;
  transfer: ArrayBuffer[];
  speculative: (() => boolean) | undefined;
  resolve: (score: number) => void;
  reject: (error: Error) => void;
};

/**
 * A pool's thread, and the pair it is scoring, if any.
 */
type ScoreThread = {
  worker: Worker;
  job: ScoreJob | undefined;
  /** What it threw, which its exit then fails the pair with. */
  error: Error | undefined;
  /** Ends the thread once it has been idle for the pool's idle time. */
  idle: NodeJS.Timeout | undefined;
};

/**
 * Turns the error a thread sent back into one to reject with.
 *
 * @param sent - The error's name and message.
 */
function toError(sent: { name: string; message: string }) {
  return Object.assign(new Error(sent.message), { name: sent.name }); // eg a wasm trap's RuntimeError
}

/**
 * Creates a {@link MetricsScorePool} of `size` threads, started as pairs need them. A thread that exits
 * unexpectedly fails its pair and is replaced, and idle threads don't keep the process alive.
 * Every thread's WASM memory grows to fit the largest pair it scores, up to 4 GiB, so a thread
 * idle for `idleMs` ends, freeing it, and a new one starts when pairs need it.
 *
 * @param size - How many threads to score on, at least 1.
 * @param settings - How long a thread may sit idle, and the thread's module, which answers each
 * pair it is posted with a {@link ScoreReply}; the tests pass a stand-in.
 * @throws RangeError when `size` isn't a whole number of at least 1.
 */
function createScorePool(
  size: number,
  {
    idleMs = IDLE_MS,
    workerUrl = new URL("./scoreWorker.js", import.meta.url),
  }: { idleMs?: number; workerUrl?: URL } = {}
): MetricsScorePool {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`Expected at least 1 scoring thread, got ${size}`);
  }

  const threads = new Set<ScoreThread>();
  const queue: ScoreJob[] = [];
  let closed = false;

  const rest = (thread: ScoreThread) => {
    thread.idle = setTimeout(() => {
      threads.delete(thread); // so no pair is posted to it while it stops
      void thread.worker.terminate();
    }, idleMs);
    thread.idle.unref();
  };

  const start = () => {
    const thread: ScoreThread = {
      worker: new Worker(workerUrl),
      job: undefined,
      error: undefined,
      idle: undefined,
    };

    thread.worker.on("message", (reply: ScoreReply) => {
      const { job } = thread;

      thread.job = undefined;
      thread.worker.unref();
      if ("score" in reply) {
        job?.resolve(reply.score);
      } else {
        job?.reject(toError(reply.error));
      }
      dispatch();
    });
    thread.worker.on("error", (error: Error) => {
      thread.error = error; // an uncaught exception, or a module that won't load; exit follows
    });
    thread.worker.on("exit", (code) => {
      threads.delete(thread);
      thread.job?.reject(
        closed
          ? new Error("The scoring pool was closed")
          : (thread.error ??
              new Error(`The scoring thread stopped: exit code ${code}`))
      );
      thread.job = undefined;
      dispatch(); // a replacement takes the pairs still waiting
    });
    threads.add(thread);
    return thread;
  };

  const nextJob = () =>
    queue.find((job) => job.speculative?.() !== true) ?? queue[0];

  const dispatch = () => {
    if (closed) {
      return;
    }
    for (let job = nextJob(); job !== undefined; job = nextJob()) {
      const free = [...threads].find(
        (candidate) => candidate.job === undefined
      );

      if (free === undefined && threads.size >= size) {
        break;
      }
      queue.splice(queue.indexOf(job), 1);
      try {
        const thread = free ?? start();

        thread.worker.postMessage(job.pair, job.transfer); // the reply comes on a later turn
        clearTimeout(thread.idle);
        thread.idle = undefined;
        thread.job = job;
        thread.worker.ref();
      } catch (error) {
        job.reject(error as Error); // eg memory that can't be transferred, or no thread to be had
      }
    }
    for (const thread of threads) {
      if (thread.job === undefined && thread.idle === undefined) {
        rest(thread);
      }
    }
  };

  const score: MetricsScorePool["score"] = (
    pair,
    { signal, transfer = [], speculative } = {}
  ) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error("The scoring pool was closed"));
        return;
      }
      if (signal?.aborted) {
        reject(signal.reason as Error);
        return;
      }

      const onAbort = () => {
        const index = queue.indexOf(job);

        if (index !== -1) {
          queue.splice(index, 1);
          reject(signal?.reason as Error);
        }
      };
      const job: ScoreJob = {
        pair,
        transfer,
        speculative,
        resolve: (value) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      queue.push(job);
      dispatch();
    });

  const close = async () => {
    closed = true;
    for (const job of queue.splice(0)) {
      job.reject(new Error("The scoring pool was closed"));
    }
    for (const thread of threads) {
      clearTimeout(thread.idle);
    }
    await Promise.all([...threads].map((thread) => thread.worker.terminate()));
  };

  return { size, score, close };
}

export default createScorePool;
export type { ScorePair, MetricsScorePool, ScoreReply };
