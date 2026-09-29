import FORMAT_NAMES from "../inspect/formatNames.js";
import {
  DEFAULT_LANGUAGE,
  IMAGE_LICENCE_FIELDS,
  IMAGE_RIGHTS_FIELDS,
  IMAGE_RIGHTS_FIELD_NAMES,
  buildRightsPacket,
  mergeRights,
  setRights,
} from "../rights/index.js";
import type { ImageRights, ImageRightsField } from "../rights/index.js";
import type { StripFormat, StripResult } from "../strip/index.js";
import type { ChosenCandidate, RasterCandidate } from "./candidate.js";
import type { PipelineSettings } from "./resolveSettings.js";
import type { PipelineRightsOptions, PipelineWarning } from "./types.js";

/**
 * One version of the rights an output can carry, with the packet that holds them.
 */
type RightsTier = {
  rights: ImageRights;
  /** The fields among them that the options added. */
  added: ImageRightsField[];
  /** The XMP packet, or `undefined` when there are no fields. */
  packet: Buffer | undefined;
};

/**
 * The rights a raster input's outputs carry.
 */
type SourceRights = {
  /**
   * The versions an output may carry, most first: the file's fields with the added ones, the
   * file's own, then none. An output carries the first that leaves it smaller than the input.
   */
  tiers: [RightsTier, ...RightsTier[]];
  /** The fields the input carries, which a kept original keeps. */
  own: ImageRights;
  stripAll: boolean;
};

const listFormat = new Intl.ListFormat("en-GB");

/**
 * Turns the rights options into fields.
 *
 * @param options - The fields to add.
 */
function toImageRights(options: PipelineRightsOptions = {}): ImageRights {
  const { creator, credit, copyright, rightsUrl, licensorUrl } = options;

  return {
    ...(creator === undefined ? {} : { creator: [creator] }),
    ...(credit === undefined ? {} : { credit }),
    ...(copyright === undefined
      ? {}
      : { copyright: [{ lang: DEFAULT_LANGUAGE, value: copyright }] }),
    ...(rightsUrl === undefined ? {} : { webStatement: rightsUrl }),
    ...(licensorUrl === undefined ? {} : { licensorUrl: [licensorUrl] }),
  };
}

/**
 * Builds a tier's packet.
 *
 * @param rights - The fields.
 * @param added - Which of them the options added.
 */
function toTier(rights: ImageRights, added: ImageRightsField[]): RightsTier {
  return { rights, added, packet: buildRightsPacket(rights) };
}

/**
 * Writes a packet into encoded bytes, replacing any XMP they hold.
 *
 * @param bytes - The encoded image, holding no XMP.
 * @param format - Its format.
 * @param packet - The packet, if any.
 * @returns The bytes, or `undefined` when the format can't hold the packet.
 */
function withPacket(
  bytes: Buffer,
  format: StripFormat,
  packet: Buffer | undefined
) {
  if (packet === undefined) {
    return bytes;
  }
  try {
    return setRights(bytes, format, packet);
  } catch (error) {
    if (error instanceof RangeError) {
      return undefined; // a jpeg packet over one segment's 64 KB, or an avif item table with no room for it
    }
    throw error;
  }
}

/**
 * Works out the versions of the rights a raster input's outputs may carry.
 *
 * The file's own fields are only ever dropped to remove its other metadata: when the input
 * already is its own strip carrying them, there's no version without them.
 *
 * @param bytes - The input.
 * @param format - Its format.
 * @param own - The fields it carries.
 * @param strip - Its lossless strip.
 * @param settings - Whether to strip everything, and the fields to add.
 */
function createSourceRights(
  bytes: Buffer,
  format: StripFormat,
  own: ImageRights,
  strip: StripResult,
  settings: Pick<PipelineSettings, "stripAll" | "rights">
): SourceRights {
  const none: RightsTier = { rights: {}, added: [], packet: undefined };

  if (settings.stripAll) {
    return { tiers: [none], own, stripAll: true };
  }

  const merged = mergeRights(own, toImageRights(settings.rights));
  const added = IMAGE_RIGHTS_FIELDS.filter(
    (field) => own[field] === undefined && merged[field] !== undefined
  );
  const full = toTier(merged, added);
  const ownTier = added.length === 0 ? full : toTier(own, []);
  const tiers: SourceRights["tiers"] = [full];
  const onlyRights =
    ownTier.packet !== undefined &&
    withPacket(strip.bytes, format, ownTier.packet)?.equals(bytes) === true;

  if (ownTier !== full && ownTier.packet !== undefined) {
    tiers.push(ownTier);
  }
  if (tiers.at(-1)?.packet !== undefined && !onlyRights) {
    tiers.push(none);
  }
  return { tiers, own, stripAll: false };
}

/**
 * Returns a candidate carrying a tier's rights.
 *
 * @param candidate - The candidate, holding no XMP.
 * @param tier - The rights.
 * @returns The candidate, or none when its format can't hold the packet.
 */
function withRights(
  candidate: RasterCandidate,
  tier: RightsTier
): RasterCandidate[] {
  const bytes = withPacket(candidate.bytes, candidate.format, tier.packet);

  return bytes === undefined
    ? []
    : [{ ...candidate, bytes, rights: tier.rights, rightsAdded: tier.added }];
}

/**
 * Warns when outputs lack rights fields that would have made them larger than the input, or the
 * kept input lacks fields it was given (`W_RIGHTS_NOT_ADDED`), or else when they carry no licence
 * field at all (`W_NO_RIGHTS`).
 *
 * @param rights - The input's rights.
 * @param chosen - The outputs; none means the input is kept.
 */
function rightsWarnings(
  rights: SourceRights,
  chosen: ChosenCandidate[]
): PipelineWarning[] {
  const wanted = rights.tiers[0].rights;
  const lacks = (carried: ImageRights = {}) =>
    IMAGE_RIGHTS_FIELDS.filter(
      (field) => wanted[field] !== undefined && carried[field] === undefined
    );
  const short = chosen.filter(
    (candidate) => lacks(candidate.rights).length > 0
  );
  const missing = new Set(
    chosen.length === 0
      ? lacks(rights.own)
      : short.flatMap((candidate) => lacks(candidate.rights))
  );

  if (missing.size > 0) {
    const names = listFormat.format(
      IMAGE_RIGHTS_FIELDS.filter((field) => missing.has(field)).map(
        (field) => IMAGE_RIGHTS_FIELD_NAMES[field]
      )
    );
    const formats = new Set(
      short.map((candidate) => FORMAT_NAMES[candidate.format])
    );
    const plural = missing.size > 1;

    return [
      {
        code: "W_RIGHTS_NOT_ADDED",
        message:
          chosen.length === 0
            ? `The file was kept as it is, so the ${names} ${plural ? "weren't" : "wasn't"} added` // kept for its size, or because nothing at a new width was smaller
            : `The ${names} would have made the ${listFormat.format(formats)} larger than the original, so ${plural ? "they were" : "it was"} left out`,
      },
    ];
  }
  if (
    rights.stripAll ||
    IMAGE_LICENCE_FIELDS.some((field) => wanted[field] !== undefined)
  ) {
    return [];
  }
  return [
    {
      code: "W_NO_RIGHTS",
      message: "The image has no creator, credit, copyright or licence fields",
    },
  ];
}

export { createSourceRights, rightsWarnings, withRights };
export type { RightsTier, SourceRights };
