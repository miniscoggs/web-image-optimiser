import { afterEach, describe, expect, it } from "vitest";
import createProcessSlot from "../../src/pipeline/processSlot.js";
import type { ProcessSlot } from "../../src/pipeline/processSlot.js";

const CHILD = new URL("./processSlot.child.mjs", import.meta.url);

type ChildReply = { type: "pid" | "aborted"; pid: number };

let slot: ProcessSlot | undefined;

/**
 * Returns whether a process is still running.
 *
 * @param pid - The process's ID.
 */
function isRunning(pid: number) {
  try {
    process.kill(pid, 0); // signal 0 only checks that it exists
    return true;
  } catch {
    return false;
  }
}

/**
 * Asks the slot's child for its pid.
 *
 * @param current - The slot.
 */
async function pidOf(current: ProcessSlot) {
  const outcome = await current.send<ChildReply>({ type: "pid" });

  if (outcome.type !== "reply") {
    throw new Error(`the child should reply, but ${outcome.detail}`);
  }
  return outcome.reply.pid;
}

afterEach(async () => {
  await slot?.close();
  slot = undefined;
});

describe("createProcessSlot", () => {
  it("resolves a message whose child exits as crashed, and starts a fresh child for the next", async () => {
    slot = createProcessSlot(CHILD);

    const first = await pidOf(slot);
    const crashed = await slot.send({ type: "exit" });
    const second = await pidOf(slot);

    expect(crashed).toEqual({ type: "crashed", detail: "exit code 3" });
    expect(second).not.toBe(first);
    expect(isRunning(first)).toBe(false);
  });

  it("sends the abort message when the signal aborts", async () => {
    slot = createProcessSlot(CHILD);

    const controller = new AbortController();
    const outcome = slot.send<ChildReply>(
      { type: "wait" },
      { signal: controller.signal, abort: { type: "abort" } }
    );

    controller.abort();
    expect(await outcome).toMatchObject({
      type: "reply",
      reply: { type: "aborted" },
    });
  });

  it("stops its child on close, ending a message under way as crashed", async () => {
    slot = createProcessSlot(CHILD);

    const pid = await pidOf(slot);
    const waiting = slot.send({ type: "wait" });

    await slot.close();
    expect(await waiting).toMatchObject({ type: "crashed" });
    expect(isRunning(pid)).toBe(false);
  });
});
