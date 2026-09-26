import { describe, expect, it } from "vitest";
import readEvents from "../../ui/src/readEvents.js";

/**
 * Reads every event from a stream of byte chunks.
 *
 * @param chunks - The chunks.
 */
async function eventsOf(chunks: BufferSource[]) {
  const stream = new ReadableStream<BufferSource>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  const events = [];

  for await (const event of readEvents(stream)) {
    events.push(event);
  }
  return events;
}

describe("readEvents", () => {
  it("reads events however the bytes are split, even inside a character", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"input":"root/é.png"}\n\nevent: error\ndata: {"error":"broke"}\n\n'
    );

    for (let cut = 0; cut <= bytes.length; cut += 1) {
      expect(
        await eventsOf([bytes.subarray(0, cut), bytes.subarray(cut)])
      ).toEqual([
        { event: "message", data: '{"input":"root/é.png"}' },
        { event: "error", data: '{"error":"broke"}' },
      ]);
    }
  });

  it("joins data lines, takes a value without its space, and skips comments", async () => {
    const bytes = new TextEncoder().encode(
      ": keep-alive\nevent:done\ndata:first\ndata: second\n\n"
    );

    expect(await eventsOf([bytes])).toEqual([
      { event: "done", data: "first\nsecond" },
    ]);
  });

  it("drops an event the stream ends before finishing", async () => {
    const bytes = new TextEncoder().encode("data: 1\n\ndata: 2\n");

    expect(await eventsOf([bytes])).toEqual([{ event: "message", data: "1" }]);
  });
});
