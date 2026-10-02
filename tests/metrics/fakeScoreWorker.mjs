// stands in for src/metrics/scoreWorker.ts in the score pool's tests: a pair blocks the thread
// for `width` ms and scores how many pairs the thread has been sent, and a `height` of 1 exits
// the thread, 2 replies with an error, and 3 throws one uncaught
import { parentPort } from "node:worker_threads";

let pairs = 0;

parentPort.on("message", ({ width, height }) => {
  pairs++;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, width); // blocks, as a wasm score does
  if (height === 1) {
    process.exit(3);
  }
  if (height === 2) {
    parentPort.postMessage({
      error: { name: "RuntimeError", message: "unreachable" },
    });
    return;
  }
  if (height === 3) {
    throw new RangeError("Lost the pair");
  }
  parentPort.postMessage({ score: pairs });
});
