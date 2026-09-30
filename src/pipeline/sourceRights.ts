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
import type { Candidate, RasterCandidate } from "./candidate.js";
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
const NO_RIGHTS: RightsTier = { rights: {}, added: [], packet: undefined };

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
 * Writes a packet into encoded bytes, replacing any XMP they hold, or removes their XMP when
 * there's no packet.
 *
 * @param bytes - The encoded image.
 * @param format - Its format.
 * @param packet - The packet, if any.
 * @returns The bytes, or `undefined` when the format can't hold the packet.
 */
function withPacket(
  bytes: Buffer,
  format: StripFormat,
  packet: Buffer | undefined
) {
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
 * Returns the rights an output carries when it has room for them: the file's own fields with
 * the added ones, or none with `stripAll`.
 *
 * @param own - The fields the file carries.
 * @param settings - Whether to strip everything, and the fields to add.
 */
function wantedRights(
  own: ImageRights,
  settings: Pick<PipelineSettings, "stripAll" | "rights">
) {
  if (settings.stripAll) {
    return NO_RIGHTS;
  }

  const merged = mergeRights(own, toImageRights(settings.rights));
  const added = IMAGE_RIGHTS_FIELDS.filter(
    (field) => own[field] === undefined && merged[field] !== undefined
  );

  return toTier(merged, added);
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
  const full = wantedRights(own, settings);

  if (settings.stripAll) {
    return { tiers: [full], own, stripAll: true };
  }

  const ownTier = full.added.length === 0 ? full : toTier(own, []);
  const tiers: SourceRights["tiers"] = [full];
  const onlyRights =
    ownTier.packet !== undefined &&
    withPacket(strip.bytes, format, ownTier.packet)?.equals(bytes) === true;

  if (ownTier !== full && ownTier.packet !== undefined) {
    tiers.push(ownTier);
  }
  if (tiers.at(-1)?.packet !== undefined && !onlyRights) {
    tiers.push(NO_RIGHTS);
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
  const bytes =
    tier.packet === undefined
      ? candidate.bytes // which holds none already
      : withPacket(candidate.bytes, candidate.format, tier.packet);

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
  chosen: Pick<Candidate, "format" | "rights">[]
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

/**
 * Writes the rights an output carries when it has room for them into an encoded image, replacing
 * any XMP it holds, as when the app's metadata options change. Unlike a run, it drops no field to
 * keep the image smaller than its input, only the fields the format can't hold, as a run does:
 * the added ones, then the file's own.
 *
 * @param bytes - The encoded image.
 * @param format - Its format.
 * @param own - The fields its input carries.
 * @param settings - Whether to strip everything, and the fields to add.
 * @returns The image, the fields it carries, which of them were added and the warnings.
 */
function applyRights(
  bytes: Buffer,
  format: StripFormat,
  own: ImageRights,
  settings: Pick<PipelineSettings, "stripAll" | "rights">
) {
  const wanted = wantedRights(own, settings);
  const rights: SourceRights = {
    tiers: [wanted],
    own,
    stripAll: settings.stripAll,
  };
  const applied = (written: Buffer, tier: RightsTier) => ({
    bytes: written,
    rights: tier.rights,
    rightsAdded: tier.added,
    warnings: rightsWarnings(rights, [{ format, rights: tier.rights }]),
  });
  const tiers = wanted.added.length > 0 ? [wanted, toTier(own, [])] : [wanted];

  for (const tier of tiers) {
    const written = withPacket(bytes, format, tier.packet);

    if (written !== undefined) {
      return applied(written, tier);
    }
  }
  return applied(setRights(bytes, format, undefined), NO_RIGHTS); // removing the xmp always fits
}

export { applyRights, createSourceRights, rightsWarnings, withRights };
export type { RightsTier, SourceRights };
