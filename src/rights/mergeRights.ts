import { IMAGE_RIGHTS_FIELDS } from "./types.js";
import type { ImageRights } from "./types.js";

/**
 * Fills the fields a file lacks from added ones, never replacing a field the file has.
 *
 * @param fromFile - The fields the file carries.
 * @param added - The fields to add where the file has none.
 * @returns The merged fields, in the order {@link ImageRights} lists them.
 */
function mergeRights(fromFile: ImageRights, added: ImageRights): ImageRights {
  const entries = IMAGE_RIGHTS_FIELDS.flatMap((field) => {
    const value = fromFile[field] ?? added[field];

    return value === undefined ? [] : [[field, value] as const];
  });

  return Object.fromEntries(entries);
}

export default mergeRights;
