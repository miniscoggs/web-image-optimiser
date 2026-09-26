// a batch worker's entry point, loaded only by createWorkerExecutor; it runs one file at a time
import { parentPort } from "node:worker_threads";
import { runFile } from "./executors.js";
import type { WorkerReply, WorkerRequest } from "./executors.js";

let controller: AbortController | undefined;

parentPort?.on("message", (request: WorkerRequest) => {
  if (request.type === "abort") {
    controller?.abort();
    return;
  }

  const current = new AbortController();
  const reply = (message: WorkerReply) => {
    parentPort?.postMessage(message);
  };

  controller = current;
  runFile(request.task, current.signal).then(
    (result) => {
      reply({ type: "done", result });
    },
    () => {
      reply({ type: "aborted" }); // runFile only rejects once aborted
    }
  );
});
