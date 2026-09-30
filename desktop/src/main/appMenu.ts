import { Menu, app } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { toolVersions } from "#app";

const IS_MAC = process.platform === "darwin";

/**
 * Fills in the About panel with the versions of wio, sharp and libvips, which the results of a
 * run depend on.
 */
function setAboutPanel() {
  const versions = toolVersions();
  const engine = `sharp ${versions.sharp}, libvips ${versions.libvips}`;

  app.setAboutPanelOptions({
    applicationName: "Web Image Optimiser",
    applicationVersion: versions.version,
    copyright: "MIT licence",
    ...(IS_MAC ? { version: engine } : { credits: engine }), // what each OS's panel shows
  });
}

/**
 * Sets the app's menu: File (Open..., Save All, and Quit or Close), Edit, View, Window, and
 * About, in the app menu on macOS and under Help elsewhere.
 *
 * @param options - What the File menu's items do, and whether this is a development build.
 * @param options.chooseAndOpen - Shows the open dialog and opens what is chosen.
 * @param options.saveAll - Saves every finished image's suite, which only the page can do.
 * @param options.development - Whether to add reloading and the developer tools to View.
 */
function setAppMenu({
  chooseAndOpen,
  saveAll,
  development,
}: {
  chooseAndOpen: () => void;
  saveAll: () => void;
  development: boolean;
}) {
  const developer: MenuItemConstructorOptions[] = development
    ? [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
      ]
    : [];
  const appMenu: MenuItemConstructorOptions[] = IS_MAC
    ? [{ role: "appMenu" }]
    : [];
  const help: MenuItemConstructorOptions[] = IS_MAC
    ? []
    : [{ label: "Help", submenu: [{ role: "about" }] }];
  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: "File",
      submenu: [
        {
          id: "open",
          label: "Open...",
          accelerator: "CmdOrCtrl+O",
          click: chooseAndOpen,
        },
        {
          id: "save-all",
          label: "Save All",
          accelerator: "CmdOrCtrl+Shift+S",
          click: saveAll,
        },
        { type: "separator" },
        IS_MAC ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [...developer, { role: "togglefullscreen" }],
    },
    { role: "windowMenu" },
    ...help,
  ];

  setAboutPanel();
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export default setAppMenu;
