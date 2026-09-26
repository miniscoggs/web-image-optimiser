/**
 * One server-sent event: its name, `message` when it has none, and its data.
 */
type ServerSentEvent = { event: string; data: string };

/**
 * Parses one event's lines, each a field, a colon, an optional space and a value.
 *
 * @param block - The event's text, without the blank line that ends it.
 */
function parseEvent(block: string): ServerSentEvent {
  let event = "message";
  const data: string[] = [];

  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");

    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  return { event, data: data.join("\n") };
}

/**
 * Reads a server-sent event stream as it arrives. `EventSource` can only make GET requests,
 * and a run is a POST.
 *
 * @param body - The response's body.
 */
async function* readEvents(
  body: ReadableStream<BufferSource>
): AsyncGenerator<ServerSentEvent> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      return; // an event without its blank line is incomplete, so it is dropped
    }
    pending += value;

    const blocks = pending.split("\n\n");

    pending = blocks.pop() ?? "";
    for (const block of blocks) {
      yield parseEvent(block);
    }
  }
}

export default readEvents;
export type { ServerSentEvent };
