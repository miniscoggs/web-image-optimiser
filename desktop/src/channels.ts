/**
 * The IPC channels between the desktop app's main process and its preload. The page answers
 * none of them itself: it reaches them only through the preload's `window.wio`.
 */
const CHANNELS = {
  openFiles: "wio:open-files",
  openDropped: "wio:open-dropped",
  saveOutput: "wio:save-output",
  saveSuites: "wio:save-suites",
  loadOptions: "wio:load-options",
  saveOptions: "wio:save-options",
  filesOpened: "wio:files-opened",
  filesSubscribed: "wio:files-subscribed",
  menuCommand: "wio:menu-command",
} as const;

export default CHANNELS;
