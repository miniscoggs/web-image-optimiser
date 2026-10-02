import { afterEach, describe, expect, it, vi } from "vitest";
import type { MetricsScorePool } from "../../src/metrics/index.js";

const FAKE_WORKER = new URL("./fakeScoreWorker.mjs", import.meta.url);
const EXITS = 1;
const REPLIES_WITH_ERROR = 2;
const THROWS = 3;

const threadStarts = { failing: 0 }; // how many of the next threads fail to start, as when the OS has none to give

vi.doMock("node:worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();

  class FailingWorker extends actual.Worker {
    constructor(...args: ConstructorParameters<typeof actual.Worker>) {
      if (threadStarts.failing > 0) {
        threadStarts.failing--;
        throw new Error("No thread");
      }
      super(...args);
    }
  }
  return { ...actual, Worker: FailingWorker };
});

const { createScorePool } = await import("../../src/metrics/index.js");

const pools: MetricsScorePool[] = [];

/**
 * Creates a pool of the stand-in worker, closed after the test.
 *
 * @param size - How many threads.
 * @param idleMs - How long a thread may sit idle.
 */
function poolOf(size: number, idleMs?: number) {
  const pool = createScorePool(size, { idleMs, workerUrl: FAKE_WORKER });

  pools.push(pool);
  return pool;
}

/**
 * Makes a pair for the stand-in worker, which scores how many pairs its thread has been sent.
 *
 * @param blockMs - How long it blocks the thread.
 * @param command - What else the thread does instead, if anything.
 */
function pairOf(blockMs = 0, command = 0) {
  return {
    reference: new Uint8Array(3),
    distorted: new Uint8Array(3),
    width: blockMs,
    height: command,
  };
}

afterEach(async () => {
  threadStarts.failing = 0;
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

describe("createScorePool", () => {
  it("scores pairs in the order they arrive", async () => {
    const pool = poolOf(1);
    const settled: number[] = [];
    const scores = [pairOf(100), pairOf(), pairOf()].map((pair) =>
      pool.score(pair).then((score) => {
        settled.push(score);
        return score;
      })
    );

    await expect(Promise.all(scores)).resolves.toEqual([1, 2, 3]);
    expect(settled).toEqual([1, 2, 3]);
  });

  it("scores as many pairs at once as it has threads", async () => {
    const pool = poolOf(2);
    const scores = await Promise.all(
      [1, 2, 3, 4].map(() => pool.score(pairOf(50)))
    );

    expect(scores.filter((score) => score === 1)).toEqual([1, 1]); // each thread's first; how the rest split depends on how fast each started
  });

  it("scores pairs ahead of need after the rest, taking one that has become needed in its turn", async () => {
    const pool = poolOf(1);
    const needed = new Set<string>();
    const scoreAs = (name: string) =>
      pool.score(pairOf(name === "blocking" ? 100 : 0), {
        speculative: () => !needed.has(name),
      });

    needed.add("blocking");
    needed.add("needed");

    const scores = ["blocking", "ahead", "promoted", "needed"].map(scoreAs);

    needed.add("promoted"); // while it waits

    await expect(Promise.all(scores)).resolves.toEqual([1, 4, 2, 3]);
  });

  it("drops a waiting pair when its signal aborts, and finishes the one being scored", async () => {
    const pool = poolOf(1);
    const controller = new AbortController();
    const { signal } = controller;
    const scoring = pool.score(pairOf(200), { signal });
    const waiting = pool.score(pairOf(), { signal });
    const after = pool.score(pairOf());

    controller.abort(new Error("Stopped"));

    await expect(waiting).rejects.toThrow("Stopped");
    await expect(pool.score(pairOf(), { signal })).rejects.toThrow("Stopped");
    await expect(scoring).resolves.toBe(1);
    await expect(after).resolves.toBe(2); // the dropped pair never reached the thread
  });

  it("fails a pair whose thread exits, and replaces the thread for the pairs waiting", async () => {
    const pool = poolOf(1);
    const exiting = pool.score(pairOf(0, EXITS));
    const waiting = pool.score(pairOf());

    await expect(exiting).rejects.toThrow(
      "The scoring thread stopped: exit code 3"
    );
    await expect(waiting).resolves.toBe(1);
  });

  it("fails a pair with what its thread threw uncaught", async () => {
    const pool = poolOf(1);

    await expect(pool.score(pairOf(0, THROWS))).rejects.toThrow(
      "Lost the pair"
    );
    await expect(pool.score(pairOf())).resolves.toBe(1);
  });

  it("fails a pair no thread can start for, leaving it out of the queue", async () => {
    const pool = poolOf(1);

    threadStarts.failing = 1;

    await expect(pool.score(pairOf())).rejects.toThrow("No thread");
    await expect(pool.score(pairOf())).resolves.toBe(1); // the failed pair never reached the thread
  });

  it("fails the pairs waiting when no replacement thread can start", async () => {
    const pool = poolOf(1);
    const exiting = pool.score(pairOf(0, EXITS));
    const waiting = pool.score(pairOf());

    threadStarts.failing = 1;

    await expect(exiting).rejects.toThrow("exit code 3");
    await expect(waiting).rejects.toThrow("No thread");
  });

  it("rejects with the error a thread sends back, and keeps the thread", async () => {
    const pool = poolOf(1);

    await expect(pool.score(pairOf(0, REPLIES_WITH_ERROR))).rejects.toThrow(
      expect.objectContaining({ name: "RuntimeError", message: "unreachable" })
    );
    await expect(pool.score(pairOf())).resolves.toBe(2);
  });

  it("transfers the memory it's given rather than copying it", async () => {
    const pool = poolOf(1);
    const pair = pairOf();

    await pool.score(pair, { transfer: [pair.reference.buffer] });

    expect(pair.reference.byteLength).toBe(0);
    expect(pair.distorted.byteLength).toBe(3);
  });

  it("ends a thread idle for the idle time, and starts a new one for the next pair", async () => {
    const pool = poolOf(1, 100);

    await expect(pool.score(pairOf())).resolves.toBe(1);
    await expect(pool.score(pairOf())).resolves.toBe(2); // inside it, the same thread
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    await expect(pool.score(pairOf())).resolves.toBe(1);
  });

  it("starts a new thread for a pair that arrives as an idle one ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pool = poolOf(1, 100);

      await pool.score(pairOf());
      vi.advanceTimersByTime(100); // the thread is ending, but hasn't exited
      await expect(pool.score(pairOf())).resolves.toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an idle thread that takes a pair, scoring it past the idle time", async () => {
    const pool = poolOf(1, 100);

    await pool.score(pairOf());
    await expect(pool.score(pairOf(300))).resolves.toBe(2);
  });

  it("fails the pairs waiting or being scored when closed, and any after", async () => {
    const pool = poolOf(1);
    const failures = [pool.score(pairOf(200)), pool.score(pairOf())].map(
      (score) => expect(score).rejects.toThrow("The scoring pool was closed")
    );

    await pool.close();

    await Promise.all(failures);
    await expect(pool.score(pairOf())).rejects.toThrow(
      "The scoring pool was closed"
    );
  });

  it("refuses a size below 1 or a fraction", () => {
    expect(() => poolOf(0)).toThrow(RangeError);
    expect(() => poolOf(1.5)).toThrow(RangeError);
  });
});
