import { Worker } from "node:worker_threads";

/**
 * How a message sent to a {@link WorkerSlot} ended: the worker's reply, or why the worker
 * stopped, crashed or couldn't start.
 */
type WorkerOutcome<Reply> =
  { type: "reply"; reply: Reply } | { type: "crashed"; detail: string };

/**
 * A worker thread that answers one message at a time. It starts on the first message, and a
 * worker that crashes is replaced on the next.
 */
type WorkerSlot = {
  /** Posts a message and resolves with the reply, never rejecting. `abort` is posted when `signal` aborts first. */
  send: <Reply>(
    message: unknown,
    options?: { signal?: AbortSignal; abort?: unknown }
  ) => Promise<WorkerOutcome<Reply>>;
  /** Terminates the worker, which ends a message under way as `crashed`. */
  close: () => Promise<void>;
};

/**
 * Creates a {@link WorkerSlot} for a worker module.
 *
 * @param workerUrl - The worker module.
 */
function createWorkerSlot(workerUrl: URL): WorkerSlot {
  let worker: Worker | undefined;

  const send = <Reply>(
    message: unknown,
    { signal, abort }: { signal?: AbortSignal; abort?: unknown } = {}
  ) =>
    new Promise<WorkerOutcome<Reply>>((resolve) => {
      let current: Worker;

      try {
        current = worker ??= new Worker(workerUrl);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);

        resolve({ type: "crashed", detail }); // eg too few threads or too little memory to start one
        return;
      }

      const onAbort = () => {
        current.postMessage(abort);
      };
      const settle = () => {
        signal?.removeEventListener("abort", onAbort);
        current.off("message", onMessage);
        current.off("error", onCrash);
        current.off("exit", onCrash);
      };
      const onMessage = (reply: Reply) => {
        settle();
        resolve({ type: "reply", reply });
      };
      const onCrash = (cause: Error | number) => {
        settle();
        if (worker === current) {
          worker = undefined;
        }
        void current.terminate();
        resolve({
          type: "crashed",
          detail: cause instanceof Error ? cause.message : `exit code ${cause}`,
        });
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      current.on("message", onMessage);
      current.once("error", onCrash);
      current.once("exit", onCrash);
      current.postMessage(message);
    });

  const close = async () => {
    const current = worker;

    worker = undefined;
    await current?.terminate();
  };

  return { send, close };
}

export default createWorkerSlot;
export type { WorkerOutcome, WorkerSlot };
