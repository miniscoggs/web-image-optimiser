import { vi } from "vitest";
import type { AppOptions } from "../../src/app/api.js";
import type {
  DesktopBridge,
  DesktopMenuCommand,
  DesktopOpened,
} from "../../ui/src/desktop.d.ts";

// the page reaches the desktop app only through window.wio, so its tests stub the bridge

/**
 * Returns opened images, as the bridge answers.
 *
 * @param names - The files' names, each opened as `file/<n>/<name>`.
 */
function openedOf(...names: string[]): DesktopOpened {
  return {
    outcome: "opened",
    files: names.map((name, index) => ({
      ref: `file/${index + 1}/${name}`,
      name,
      bytes: 100_000,
    })),
  };
}

/**
 * Stubs `window.wio`.
 *
 * @param overrides - The calls to answer differently.
 * @returns The stub, what unsubscribing calls, and functions that send files and commands as the
 * app does from its menu.
 */
function stubWio(overrides: Partial<DesktopBridge> = {}) {
  let subscriber: ((opened: DesktopOpened) => void) | undefined;
  let menuSubscriber: ((command: DesktopMenuCommand) => void) | undefined;
  const unsubscribe = vi.fn();
  const options: AppOptions = { stripAll: false, rights: {} };
  const bridge = {
    openFiles: vi.fn<DesktopBridge["openFiles"]>(() =>
      Promise.resolve({ outcome: "canceled" })
    ),
    openDropped: vi.fn<DesktopBridge["openDropped"]>(() =>
      Promise.resolve(openedOf())
    ),
    saveOutput: vi.fn<DesktopBridge["saveOutput"]>(),
    saveSuites: vi.fn<DesktopBridge["saveSuites"]>(),
    loadOptions: vi.fn<DesktopBridge["loadOptions"]>(() =>
      Promise.resolve(options)
    ),
    saveOptions: vi.fn<DesktopBridge["saveOptions"]>(() => Promise.resolve()),
    onFilesOpened: vi.fn<DesktopBridge["onFilesOpened"]>((callback) => {
      subscriber = callback;
      return unsubscribe;
    }),
    onMenuCommand: vi.fn<DesktopBridge["onMenuCommand"]>((callback) => {
      menuSubscriber = callback;
      return vi.fn();
    }),
    ...overrides,
  } satisfies DesktopBridge;

  vi.stubGlobal("wio", bridge);
  return {
    bridge,
    unsubscribe,
    send: (opened: DesktopOpened) => {
      subscriber?.(opened);
    },
    sendMenu: (command: DesktopMenuCommand) => {
      menuSubscriber?.(command);
    },
  };
}

export { openedOf, stubWio };
