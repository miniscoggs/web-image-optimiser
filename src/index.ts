// library entry; public modules are re-exported from here
export {
  createDiffMap,
  decodeForScoring,
  isDownscaledForScoring,
  isScorable,
  score,
  verdictFor,
} from "./metrics/index.js";
export type { MetricsImage, MetricsVerdict } from "./metrics/index.js";
