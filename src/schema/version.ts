/**
 * The version of the JSON contract. It changes only when a field is renamed, removed or changes
 * meaning; adding a field keeps it.
 *
 * @example
 * ```ts
 * import { SCHEMA_VERSION } from "../schema/index.js";
 *
 * const result = { schemaVersion: SCHEMA_VERSION };
 * ```
 */
const SCHEMA_VERSION = 1;

export default SCHEMA_VERSION;
