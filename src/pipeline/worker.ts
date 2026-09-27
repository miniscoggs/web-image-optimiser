// a batch lane's child process, forked only by createProcessExecutor; it runs one file at a time
import { runFile } from "./executors.js";
import type { WorkerReply, WorkerRequest } from "./executors.js";

let controller: AbortController | undefined;

const ignore = () => undefined;

process.on("SIGINT", ignore); // a terminal's ctrl+c reaches the whole group; the parent's abort message stops the file, which then removes its temp files
process.on("SIGTERM", ignore);
process.on("disconnect", () => {
  process.exit(); // the parent is gone, so no orphan is left behind
});
process.on("message", (request: WorkerRequest) => {
  if (request.type === "abort") {
    controller?.abort();
    return;
  }

  const current = new AbortController();
  const reply = (message: WorkerReply) => {
    process.send?.(message);
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
