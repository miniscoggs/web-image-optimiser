// a score pool's thread, started only by createScorePool; it scores one pair at a time
import { parentPort } from "node:worker_threads";
import type { ScorePair, ScoreReply } from "./scorePool.js";
import scoreSsimulacra2 from "./ssimulacra2.js";

parentPort?.on("message", (pair: ScorePair) => {
  let reply: ScoreReply;

  try {
    reply = {
      score: scoreSsimulacra2(
        pair.reference,
        pair.distorted,
        pair.width,
        pair.height
      ),
    };
  } catch (error) {
    reply = {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: "Error", message: String(error) },
    };
  }
  parentPort?.postMessage(reply);
});
