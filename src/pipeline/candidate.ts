import type { InspectFormat } from "../inspect/index.js";
import type { ImageRights, ImageRightsField } from "../rights/index.js";
import type { StripFormat, StripRemovedKind } from "../strip/index.js";
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
  /** The rights fields its bytes carry. Absent for SVG. */
  rights?: ImageRights;
  /** Which of them the options added. */
  rightsAdded?: ImageRightsField[];
};

/**
 * A raster candidate, which can carry rights.
 */
type RasterCandidate = Candidate & { format: StripFormat };

/**
 * A candidate picked for writing, with the role it fills.
 */
type ChosenCandidate = Candidate & { role: PipelineOutputRole };

export type { Candidate, ChosenCandidate, RasterCandidate };
