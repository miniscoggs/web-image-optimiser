/**
 * Returns whether a module is running from the TypeScript sources, as under the tests, rather
 * than from the build in `dist/`.
 *
 * @param moduleUrl - The calling module's `import.meta.url`.
 *
 * @example
 * ```ts
 * import { isSourceRun } from "../runtime/index.js";
 *
 * const wasmPath = isSourceRun(import.meta.url) ? "../../wasm/pkg" : "../wasm";
 * ```
 */
function isSourceRun(moduleUrl: string) {
  return new URL(moduleUrl).pathname.endsWith(".ts");
}

export default isSourceRun;
