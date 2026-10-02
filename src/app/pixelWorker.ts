// the app api's pixel process, forked only by createPixelRunner; it runs one job at a time
import type { PixelJob, PixelReply } from "./pixelJobs.js";

const ignore = () => undefined;

process.on("SIGINT", ignore); // a terminal's ctrl+c reaches the whole group; the api's close stops this process
process.on("SIGTERM", ignore);
process.on("disconnect", () => {
  process.exit(); // the api is gone, so no orphan is left behind
});

const { createScorePool } = await import("../metrics/index.js"); // after the handlers, as loading the engine can take seconds on a busy machine; node holds messages until there's a listener
const { runPixelJob } = await import("./pixelJobs.js");
const scorers = Number(process.argv[2]); // how many scores a job runs at once
const scorePool = scorers > 1 ? createScorePool(scorers) : undefined; // else this thread scores

process.on("message", (job: PixelJob) => {
  void runPixelJob(job, scorePool).then((reply: PixelReply) => {
    process.send?.(reply);
  });
});
