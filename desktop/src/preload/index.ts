import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { IpcRendererEvent } from "electron";
import type { DesktopBridge } from "../../../ui/src/desktop.js";
import CHANNELS from "../channels.js";

// the desktop app's preload, bundled into one commonjs file, since a sandboxed preload can only
// require electron's own modules

/**
 * Listens on a channel the main process sends to, passing the callback the payload alone, so
 * the page never holds the IPC event.
 *
 * @param channel - The channel.
 * @param callback - What to call with each payload.
 * @returns A function that stops listening.
 */
function subscribe<Payload>(
  channel: string,
  callback: (payload: Payload) => void
) {
  const listener = (_event: IpcRendererEvent, payload: Payload) => {
    callback(payload);
  };

  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const bridge: DesktopBridge = {
  openFiles: () => ipcRenderer.invoke(CHANNELS.openFiles),
  openDropped: (files) => {
    const paths = Array.from(files, (file) => webUtils.getPathForFile(file));

    return ipcRenderer.invoke(
      CHANNELS.openDropped,
      paths.filter((filePath) => filePath !== "") // a file the page made has no path
    );
  },
  saveOutput: (refs) => ipcRenderer.invoke(CHANNELS.saveOutput, refs),
  saveSuites: (suites) => ipcRenderer.invoke(CHANNELS.saveSuites, suites),
  loadOptions: () => ipcRenderer.invoke(CHANNELS.loadOptions),
  saveOptions: (options) => ipcRenderer.invoke(CHANNELS.saveOptions, options),
  onFilesOpened: (callback) => {
    const unsubscribe = subscribe(CHANNELS.filesOpened, callback);

    ipcRenderer.send(CHANNELS.filesSubscribed); // main holds what it opened before now
    return unsubscribe;
  },
  onMenuCommand: (callback) => subscribe(CHANNELS.menuCommand, callback),
};

contextBridge.exposeInMainWorld("wio", bridge);
