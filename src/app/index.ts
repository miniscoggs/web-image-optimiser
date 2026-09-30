// the desktop's main process imports only this module, through the root package.json's #app
export { default as APP_HEADERS } from "./appHeaders.js";
export { default as readAppOptions } from "./appOptions.js";
export { default as createAppApi } from "./createAppApi.js";
export { default as describeFailure } from "./describeFailure.js";
export { default as FORMAT_NAMES } from "../inspect/formatNames.js";
export { EXTENSIONS, formatOfExtension } from "../pipeline/destination.js";
export { default as toolVersions } from "../pipeline/toolVersions.js";
export type { AppOptions, AppSaveOutputRefs, AppSaveSuites } from "./api.js";
export type { AppApi } from "./createAppApi.js";
