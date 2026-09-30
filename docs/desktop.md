# Desktop app

Web Image Optimiser's desktop app opens images from your computer, optimises each one into an AVIF, a WebP and a JPEG or PNG fallback, and lets you compare them with the original before saving. It runs the same engine as the `wio` command line, in `suite` mode, and writes nothing beside your images until you save.

## Installing

The installers aren't signed yet, so each OS warns before the first launch.

- **Windows:** run `wio-<version>-win-x64.exe`, which installs the app for your user alone. If SmartScreen says it protected your PC, choose **More info**, then **Run anyway**.
- **macOS:** open the `.dmg` for your Mac (`arm64` for Apple silicon, `x64` for Intel) and drag the app into Applications. The first launch is refused: open **System Settings**, then **Privacy & Security**, and choose **Open Anyway** beside the app's name. On macOS 15 and later, right-clicking the app and choosing Open no longer gets past this.

To run it from a clone instead, with Node.js 24 or later: `npm install`, `npm run build:desktop`, then `npx electron .`. `npm run package:desktop` builds the installer for the OS it runs on into `release/`.

## Opening images

With nothing open, the window is one drop zone. Choose **Browse**, drop images anywhere in the window, or use **File**, then **Open...**. Once images are open, **Open...** in the toolbar and **Open more** in the image list add more. The open dialog starts in the folder you last opened images from, or your home folder the first time.

The app reads PNG, JPEG, WebP, AVIF and SVG files, telling them apart by their contents rather than their names. A file that isn't one of them isn't opened, and the window says why. Opening an image that is already open does nothing, unless you have replaced its original (see Saving).

## Opening images from the OS

The installers register the app for PNG, JPEG, WebP, AVIF and SVG files, so it appears in the OS's Open with menu. It never becomes the default app for any of them.

- **Windows:** right-click one or more images, choose **Open with**, then **Web Image Optimiser**. Dropping images onto the app's shortcut or its `.exe` opens them too. Dropping onto its taskbar button only brings the window forward, as it does for every app on Windows, so drop them into the window then.
- **macOS:** right-click one or more images in Finder, choose **Open With**, then **Web Image Optimiser**, or drop them onto the app's Dock icon.

Images opened this way open as if you had dropped them into the window: each starts processing straight away, and the app's open dialog starts in their folder next time. When the app is already running, they open in its window, which comes to the front.

Uninstalling the app on Windows removes it from Open with, and leaves each format's default app as it was.

## Processing

Every image you open starts processing straight away, in `suite` mode at the `web` target (a score of 70, where differences are barely noticeable side by side), one batch at a time. Images opened while a batch runs wait for the next.

One image opens its comparison grid as soon as it's done. Several are listed in a panel on the left, which **Images** in the toolbar shows and hides, with each image's thumbnail, size and progress, and how much smaller it came out. Select an image to see its grid. Below the list are the batch's totals and **Save all**.

An image's warnings show above its grid, such as a colour profile that was kept or a target a format couldn't reach. An image with no creator, credit, copyright or licence fields has an **Add rights info** button beside that warning. A failed image shows why in the list and in place of its grid, and an SVG, which is only ever optimised as SVG, shows one output pane.

## Comparing

The grid shows the original beside its AVIF, WebP and fallback. Drag to pan and scroll to zoom, and every pane follows, or choose **Fit**, **100%** (one image pixel to one screen pixel), **200%** or **400%**. Each pane gives its format, size, saving, score and verdict, and can show a diff overlay, which paints where the output differs from the original, with its opacity.

Click an output to wipe it against the original, dragging the divider to move between them. **Back to grid** or Escape returns to the grid.

## Target sliders

Each output pane has a target-score slider from 50 to 100, starting at 70, with the presets marked on it: web (70), high (80), excellent (85) and visually-lossless (90). Move it and let go, and the app searches that pane's format for the smallest output that reaches the new target, then shows it in the pane. When nothing in the format reaches it, the pane shows the best it found and says **Target not reached**. **Reset** goes back to the batch's output. A search is remembered, so going back to a target is quick.

The fallback's slider searches its own format, JPEG or PNG. When the suite has no AVIF or WebP, because it would have been no smaller than the output before it (see below), its pane is empty until you move its slider. When no JPEG or PNG was smaller than the original, the fallback pane is empty and has no slider. An SVG's pane has no slider either.

## The suite

A suite keeps the fallback, then the WebP only when it's smaller than the fallback, then the AVIF only when it's smaller than the last one kept, so a browser never downloads a larger file for a newer format. After every slider move, a pane the rule leaves out says why, such as "Not in the suite: no smaller than the WebP". Save suite and Save all save the panes the suite keeps, as they're shown.

## Options

The options bar works as the command line's flags do, and the app remembers it between launches.

- **Max width** shrinks an image wider than it to that width before the search, as `--max-width` does. Changing it runs every image again.
- **Remove all metadata** removes the copyright, licence and AI-origin fields too, as `--strip-all` does.
- **Rights info** holds Creator, Credit Line, Copyright Notice, Rights URL and Licensor URL, which fill only the fields an image lacks, as `--creator`, `--credit`, `--copyright`, `--rights-url` and `--licensor-url` do. A URL must start with `http:` or `https:`, and a field that isn't valid is left out. The fields are turned off while Remove all metadata is on.

Changing the metadata options rewrites the outputs shown without searching again, since only their metadata changes, and sends the sliders back to the batch's outputs. A pane the fields make larger than the original says **Larger than the original**, and can't be saved.

**Help** says what's kept and what's removed, in the same words as `wio --help`. **About**, in the app menu on macOS and the Help menu elsewhere, shows the versions of wio, sharp and libvips.

## Saving

A pane's **Save** opens the save dialog in the original's folder, with the output named as `wio` names it: the original's name with the output's extension, keeping the original's own extension when it fits, such as `photo.jpeg`. When that name is taken, it suggests the next free one, as the OS names a copy: `photo (1).webp` on Windows and Linux, and `photo 2.webp` on macOS. A file is replaced, your original included, only once the dialog itself has asked and you have confirmed.

Once an output replaces its original, the grid keeps showing the outputs of the old one, without sliders or Save buttons. Open the image again to process the new one.

**Save suite**, above the grid, saves the panes the suite keeps. **Save all**, below the image list or in the File menu, saves every finished image's suite, skipping any unfinished, failed or replaced image and saying how many it skipped. Both ask for a folder, starting in the image's folder (the first image's for Save all), and never replace a file: an output whose name is taken gets the next free name, and the note after saving lists each one. A fallback that is its original, unchanged, saved into the original's own folder is left as it is.

Nothing larger than its original is ever saved, and every file is written to a temporary file and then renamed, so a failed save leaves no half-written file.

## Temporary files

Each batch, search, diff overlay and rewrite of the metadata is written to a folder named `.wio-app-` followed by random characters, in the OS's temp folder, which the app removes when it quits.

## Security

The app has no network port and loads nothing from the web. Its window shows a page with no access to Node.js or your files: the page runs sandboxed, stays on the app's own `wio://app` address, and asks the app for images by a reference to an image you opened, never by a path. The app reads only the images you opened and its temporary folder, and writes only its temporary folder and the files and folders you choose in a save dialog. Web links open in your browser, and every permission a page could ask for, such as the camera, is refused.
