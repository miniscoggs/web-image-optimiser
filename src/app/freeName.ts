import { readdir } from "node:fs/promises";
import path from "node:path";

const COUNTED = /^(.*) \((\d+)\)$/; // "photo (2)", a copy's name on windows and linux

/**
 * Returns whether a platform's file systems usually ignore case.
 *
 * @param platform - The platform.
 */
function ignoresCase(platform: NodeJS.Platform) {
  return platform === "win32" || platform === "darwin";
}

/**
 * Returns a name that isn't taken, as the OS names a copy: `photo (1).jpg`, then
 * `photo (2).jpg` on Windows and Linux, counting on from a name already ending in a count, or
 * Finder's `photo 2.jpg`, then `photo 3.jpg` on macOS, which never reads a count in the name.
 *
 * @param name - The name wanted, returned as it is when it's free.
 * @param isTaken - Returns whether a name is taken.
 * @param platform - The platform whose style to follow.
 */
function nextFreeName(
  name: string,
  isTaken: (name: string) => boolean,
  platform: NodeJS.Platform
) {
  if (!isTaken(name)) {
    return name;
  }

  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  const finder = platform === "darwin";
  const counted = finder ? null : COUNTED.exec(stem);
  const base = counted?.[1] ?? stem;
  const first = finder ? 2 : Number(counted?.[2] ?? 0) + 1;

  for (let count = first; ; count += 1) {
    const free = finder
      ? `${base} ${count}${extension}`
      : `${base} (${count})${extension}`;

    if (!isTaken(free)) {
      return free;
    }
  }
}

/**
 * Returns a function that hands out free names in a folder, as {@link nextFreeName} does,
 * reading the folder's names once. A name it hands out counts as taken, so no two files in one
 * save get the same name.
 *
 * @param folder - The folder.
 * @param platform - The platform, whose style is followed, and whose file systems usually
 * ignore case on Windows and macOS.
 */
async function createFreeNames(folder: string, platform: NodeJS.Platform) {
  const comparable = (name: string) => {
    const normal = name.normalize("NFC");

    return ignoresCase(platform) ? normal.toLowerCase() : normal;
  };
  const names = await readdir(folder).catch((): string[] => []); // a missing folder is made on writing
  const taken = new Set(names.map(comparable));

  return (name: string) => {
    const free = nextFreeName(
      name,
      (each) => taken.has(comparable(each)),
      platform
    );

    taken.add(comparable(free));
    return free;
  };
}

export { createFreeNames, nextFreeName };
