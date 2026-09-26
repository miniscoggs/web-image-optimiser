import type { InspectFormat } from "../inspect/index.js";
import type { StripRemovedKind } from "../strip/index.js";
import type { PipelineOutputMethod, PipelineOutputRole } from "./types.js";

/**
 * A possible output, scored against the source.
 */
type Candidate = {
  format: InspectFormat;
  method: PipelineOutputMethod;
  bytes: Buffer;
  quality?: number;
  score: number;
  gzipBytes?: number;
  strippedMetadata: StripRemovedKind[];
};

/**
 * A candidate picked for writing, with the role it fills.
 */
type ChosenCandidate = Candidate & { role: PipelineOutputRole };

export type { Candidate, ChosenCandidate };
