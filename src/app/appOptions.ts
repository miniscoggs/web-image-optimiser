import {
  PIPELINE_RIGHTS_OPTIONS,
  isMaxWidth,
  rightsFieldError,
} from "../pipeline/resolveSettings.js";
import type { AppOptions } from "./api.js";

/**
 * Returns whether a value is a plain object, whose fields can be read.
 *
 * @param value - The value.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the options bar's values, from the page or from the file the desktop app keeps them in,
 * keeping each field a run would take and dropping anything else, so a bad field never loses
 * the others.
 *
 * @param value - The values.
 * @returns The options, with the rights fields trimmed; `stripAll` is off unless it is `true`.
 */
function readAppOptions(value: unknown): AppOptions {
  const stored = isRecord(value) ? value : {};
  const rights = isRecord(stored.rights) ? stored.rights : {};
  const kept = PIPELINE_RIGHTS_OPTIONS.flatMap((name) => {
    const field = rights[name];

    return typeof field === "string" &&
      rightsFieldError(name, field) === undefined
      ? [[name, field.trim()] as const]
      : [];
  });

  return {
    ...(isMaxWidth(stored.maxWidth) ? { maxWidth: stored.maxWidth } : {}),
    stripAll: stored.stripAll === true,
    rights: Object.fromEntries(kept),
  };
}

export default readAppOptions;
