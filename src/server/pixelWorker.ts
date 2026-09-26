// the ui server's pixel worker, loaded only by createPixelRunner; it runs one job at a time
import { parentPort } from "node:worker_threads";
import { runPixelJob } from "./pixelJobs.js";
import type { PixelJob, PixelReply } from "./pixelJobs.js";

parentPort?.on("message", (job: PixelJob) => {
  void runPixelJob(job).then((reply: PixelReply) => {
    parentPort?.postMessage(reply);
  });
});
