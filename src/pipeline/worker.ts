// a batch lane's child process, forked only by createProcessExecutor; it runs one file at a time
import { createScorePool } from "../metrics/index.js";
import { runFile } from "./executors.js";
import type { WorkerReply, WorkerRequest } from "./executors.js";

const scorers = Number(process.argv[2]); // how many scores the lane runs at once
const scorePool = scorers > 1 ? createScorePool(scorers) : undefined; // else this thread scores
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
  runFile(request.task, current.signal, scorePool).then(
    (result) => {
      reply({ type: "done", result });
    },
    () => {
      reply({ type: "aborted" }); // runFile only rejects once aborted
    }
  );
});
