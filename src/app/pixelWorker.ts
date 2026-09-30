// the app api's pixel process, forked only by createPixelRunner; it runs one job at a time
import { runPixelJob } from "./pixelJobs.js";
import type { PixelJob, PixelReply } from "./pixelJobs.js";

const ignore = () => undefined;

process.on("SIGINT", ignore); // a terminal's ctrl+c reaches the whole group; the api's close stops this process
process.on("SIGTERM", ignore);
process.on("disconnect", () => {
  process.exit(); // the api is gone, so no orphan is left behind
});
process.on("message", (job: PixelJob) => {
  void runPixelJob(job).then((reply: PixelReply) => {
    process.send?.(reply);
  });
});
