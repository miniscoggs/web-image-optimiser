// library entry; public modules are re-exported from here
export { inspect } from "./inspect/index.js";
export type {
  InspectFormat,
  InspectMetadataKind,
  InspectResult,
  InspectSvg,
} from "./inspect/index.js";
export {
  createDiffMap,
  decodeForScoring,
  isDownscaledForScoring,
  isScorable,
  score,
  verdictFor,
} from "./metrics/index.js";
export type {
  MetricsDecodeOptions,
  MetricsImage,
  MetricsVerdict,
} from "./metrics/index.js";
export { optimiseBatch, optimiseFile } from "./pipeline/index.js";
export type {
  PipelineBatchInput,
  PipelineEvent,
  PipelineFileResult,
  PipelineFileStatus,
  PipelineMode,
  PipelineOptions,
  PipelineOutput,
  PipelineOutputMethod,
  PipelineOutputRole,
  PipelineRunResult,
  PipelineTargetPreset,
  PipelineWarning,
} from "./pipeline/index.js";
export { OptimiserError } from "./schema/index.js";
export type {
  OptimiserErrorCode,
  OptimiserWarningCode,
} from "./schema/index.js";
export { stripLossless } from "./strip/index.js";
export type {
  StripFormat,
  StripRemovedKind,
  StripResult,
} from "./strip/index.js";
export { optimiseSvg, stripSvg } from "./svg/index.js";
export type { SvgOptimiseResult } from "./svg/index.js";
