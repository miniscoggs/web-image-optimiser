import { PIPELINE_MODES } from "./types.js";
import type {
  PipelineOptions,
  PipelineRightsOptions,
  PipelineTargetPreset,
} from "./types.js";

/**
 * The score each {@link PipelineTargetPreset} stands for, from the SSIMULACRA 2 README's bands.
 *
 * @example
 * ```ts
 * import { PIPELINE_TARGET_PRESETS } from "../pipeline/index.js";
 *
 * PIPELINE_TARGET_PRESETS.excellent; // 85
 * ```
 */
const PIPELINE_TARGET_PRESETS = {
  "visually-lossless": 90,
  excellent: 85,
  high: 80,
  web: 70,
} as const satisfies Record<PipelineTargetPreset, number>;

/**
 * The keys of {@link PipelineRightsOptions}, in `ImageRights`' order.
 */
const PIPELINE_RIGHTS_OPTIONS = [
  "creator",
  "credit",
  "copyright",
  "rightsUrl",
  "licensorUrl",
] as const satisfies (keyof PipelineRightsOptions)[];
const URL_OPTIONS = new Set<keyof PipelineRightsOptions>([
  "rightsUrl",
  "licensorUrl",
]);

type PipelineSettings = Required<
  Omit<PipelineOptions, "outDir" | "target" | "maxWidth" | "rights">
> &
  Pick<PipelineOptions, "outDir" | "maxWidth" | "rights"> & { target: number };

/**
 * Returns whether a value is an absolute `http:` or `https:` URL.
 *
 * @param value - The value.
 */
function isWebUrl(value: string) {
  const protocol = URL.parse(value)?.protocol;

  return protocol === "http:" || protocol === "https:";
}

/**
 * Checks one rights field to add, as a run does once the value is trimmed.
 *
 * @param name - The field.
 * @param value - Its value.
 * @returns Why the value can't be used: it is empty, or a URL field's value isn't an `http:` or
 * `https:` URL; `undefined` when it can.
 */
function rightsFieldError(
  name: keyof PipelineRightsOptions,
  value: string
): string | undefined {
  const trimmed = value.trim();

  if (trimmed === "") {
    return `Expected rights.${name} to have a value`;
  }
  if (URL_OPTIONS.has(name) && !isWebUrl(trimmed)) {
    return `Expected rights.${name} to be an http: or https: URL, got ${trimmed}`;
  }
  return undefined;
}

/**
 * Returns whether a value is a maximum width a run takes: a whole number of pixels, at least 1.
 *
 * @param value - The value.
 */
function isMaxWidth(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1;
}

/**
 * Trims the rights fields to add, and checks them.
 *
 * @param rights - The caller's fields.
 * @returns The trimmed fields, or `undefined` when none is given.
 * @throws RangeError when a value is empty, or a URL isn't `http:` or `https:`.
 */
function resolveRights(rights: PipelineRightsOptions | undefined) {
  const entries = PIPELINE_RIGHTS_OPTIONS.flatMap((name) => {
    const value: unknown = rights?.[name];

    if (value === undefined) {
      return [];
    }

    const text = typeof value === "string" ? value : "";
    const error = rightsFieldError(name, text);

    if (error !== undefined) {
      throw new RangeError(error);
    }
    return [[name, text.trim()] as const];
  });

  return entries.length === 0
    ? undefined
    : (Object.fromEntries(entries) as PipelineRightsOptions);
}

/**
 * Fills in the defaults, turns a target preset into its score, and trims the rights fields.
 *
 * @param options - The caller's options.
 * @throws RangeError when the mode, target, maximum width or a rights field isn't valid, or when
 * `stripAll` comes with rights fields.
 */
function resolveSettings(options: PipelineOptions): PipelineSettings {
  const { to = "webp", target = "web", maxWidth } = options;
  const score =
    typeof target === "number" ? target : PIPELINE_TARGET_PRESETS[target];
  const rights = resolveRights(options.rights);
  const stripAll = options.stripAll ?? false;

  if (!PIPELINE_MODES.includes(to)) {
    throw new RangeError(`Unknown mode "${String(to)}"`);
  }
  if (!(score >= 0 && score <= 100)) {
    throw new RangeError(
      `Expected a target preset or a score from 0 to 100, got ${String(target)}`
    );
  }
  if (maxWidth !== undefined && !isMaxWidth(maxWidth)) {
    throw new RangeError(
      `Expected a maximum width of at least 1 pixel, got ${String(maxWidth)}`
    );
  }
  if (stripAll && rights !== undefined) {
    throw new RangeError(
      "stripAll removes the rights fields, so it can't be combined with rights to add"
    );
  }

  return {
    to,
    target: score,
    ...(options.outDir === undefined ? {} : { outDir: options.outDir }),
    inPlace: options.inPlace ?? false,
    overwrite: options.overwrite ?? false,
    dryRun: options.dryRun ?? false,
    ...(maxWidth === undefined ? {} : { maxWidth }),
    stripAll,
    ...(rights === undefined ? {} : { rights }),
  };
}

export {
  PIPELINE_RIGHTS_OPTIONS,
  PIPELINE_TARGET_PRESETS,
  isMaxWidth,
  isWebUrl,
  resolveSettings,
  rightsFieldError,
};
export type { PipelineSettings };
