import { fork } from "node:child_process";
import type { ChildProcess, Serializable } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * How a message sent to a {@link ProcessSlot} ended: the child's reply, or why the child
 * stopped, crashed or couldn't start.
 */
type ProcessOutcome<Reply> =
  { type: "reply"; reply: Reply } | { type: "crashed"; detail: string };

/**
 * A child process that answers one message at a time. It starts on the first message, and a
 * child that crashes is replaced on the next.
 */
type ProcessSlot = {
  /** Sends a message and resolves with the reply, never rejecting. `abort` is sent when `signal` aborts first. */
  send: <Reply>(
    message: Serializable,
    options?: { signal?: AbortSignal; abort?: Serializable }
  ) => Promise<ProcessOutcome<Reply>>;
  /** Stops the child and waits for it to exit, which ends a message under way as `crashed`. */
  close: () => Promise<void>;
};

/**
 * A running child, and how to settle the message it is answering, if any.
 */
type Child = {
  process: ChildProcess;
  settle?: (outcome: ProcessOutcome<unknown>) => void;
};

/**
 * Settles a child's message under way, if there is one.
 *
 * @param child - The child.
 * @param outcome - How the message ended.
 */
function settleMessage(child: Child, outcome: ProcessOutcome<unknown>) {
  const { settle } = child;

  child.settle = undefined;
  settle?.(outcome);
}

/**
 * Creates a {@link ProcessSlot} for a child module, which answers each message it gets through
 * `process.send`.
 *
 * @param moduleUrl - The child module.
 * @param args - The child's arguments, which a replacement gets too.
 * @param libuvThreads - How many threads the child's libuv pool has, which runs its sharp
 * encodes and decodes and its file system calls, if not libuv's default of 4.
 */
function createProcessSlot(
  moduleUrl: URL,
  args: string[] = [],
  libuvThreads?: number
): ProcessSlot {
  let current: Child | undefined;

  const start = () => {
    const child: Child = {
      process: fork(fileURLToPath(moduleUrl), args, {
        env:
          libuvThreads === undefined
            ? undefined
            : { ...process.env, UV_THREADPOOL_SIZE: String(libuvThreads) }, // libuv reads it only as a process starts
        execArgv: [], // not the parent's, such as --inspect
        serialization: "advanced",
        stdio: ["ignore", "ignore", "inherit", "ipc"], // stdout carries the json contract
      }),
    };
    const retire = () => {
      if (current === child) {
        current = undefined;
      }
      child.process.kill("SIGKILL"); // it ignores SIGTERM, and may be dead already
    };
    const end = (detail: string) => {
      retire();
      settleMessage(child, { type: "crashed", detail });
    };

    // attached for the child's whole life: an error event without a listener throws in the parent
    child.process.on("message", (reply) => {
      settleMessage(child, { type: "reply", reply });
    });
    child.process.on("error", (error) => {
      end(error.message);
    });
    child.process.on("exit", (code, signal) => {
      end(signal === null ? `exit code ${code}` : `signal ${signal}`);
    });
    child.process.on("disconnect", retire); // the exit that follows ends a message under way, with its code
    return child;
  };

  const send = <Reply>(
    message: Serializable,
    { signal, abort }: { signal?: AbortSignal; abort?: Serializable } = {}
  ) =>
    new Promise<ProcessOutcome<Reply>>((resolve) => {
      let child: Child;

      try {
        child = current ??= start();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);

        resolve({ type: "crashed", detail }); // eg too little memory to start one
        return;
      }

      const onAbort = () => {
        if (abort !== undefined) {
          child.process.send(abort);
        }
      };

      child.settle = (outcome) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(outcome as ProcessOutcome<Reply>);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      child.process.send(message); // a failure is an error event, which ends the child
    });

  const close = async () => {
    const child = current;

    current = undefined;
    if (
      child === undefined ||
      child.process.exitCode !== null ||
      child.process.signalCode !== null
    ) {
      return;
    }

    const exited = new Promise((resolve) => {
      child.process.once("exit", resolve);
    });

    if (child.process.connected) {
      child.process.disconnect();
    }
    child.process.kill("SIGKILL");
    await exited;
  };

  return { send, close };
}

export default createProcessSlot;
export type { ProcessOutcome, ProcessSlot };
