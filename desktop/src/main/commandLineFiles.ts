import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * Returns whether a path names an existing file, following links.
 *
 * @param filePath - The path.
 */
async function isFile(filePath: string) {
  return stat(filePath).then(
    (stats) => stats.isFile(),
    () => false
  );
}

/**
 * Returns the existing files a command line names, in order, resolved against its working
 * folder: the arguments after the executable that aren't switches, apart from the app's own path
 * when Electron was given one, as `electron .` is in development. It imports nothing from
 * Electron, so Vitest can test it.
 *
 * @param argv - The command line, the executable first.
 * @param options - Where it ran, and whether it names the app.
 * @param options.cwd - The folder a relative path is resolved against.
 * @param options.namesApp - Whether its first argument that isn't a switch is the app's path.
 */
async function commandLineFiles(
  argv: readonly string[],
  { cwd, namesApp }: { cwd: string; namesApp: boolean }
) {
  const paths = argv
    .slice(1)
    .filter((argument) => !argument.startsWith("-")) // chromium's and electron's, and macos's -psn_
    .slice(namesApp ? 1 : 0)
    .map((argument) => path.resolve(cwd, argument));
  const files = await Promise.all(paths.map(isFile));

  return paths.filter((_, index) => files[index]);
}

export default commandLineFiles;
