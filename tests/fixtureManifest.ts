import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const METADATA_KINDS = [
  "comment",
  "editor",
  "exif",
  "gps",
  "iptc",
  "text",
  "xmp",
] as const;

type FixtureEntry = {
  file: string;
  kind: string;
  format: "png" | "jpeg" | "webp" | "avif" | "svg";
  width: number;
  height: number;
  alpha: boolean;
  animated: boolean;
  bitDepth: 8 | 16;
  orientation: number;
  icc: "srgb" | "non-srgb" | null;
  metadata: (typeof METADATA_KINDS)[number][];
  svg?: { viewBox: boolean; title: boolean; referencedIds: string[] };
  source: string;
  licence: string;
};

const FIXTURE_DIR = new URL("../fixtures/", import.meta.url);

const manifestText = await readFile(
  new URL("manifest.json", FIXTURE_DIR),
  "utf8"
);
const { fixtures } = JSON.parse(manifestText) as { fixtures: FixtureEntry[] };

/**
 * Returns the filesystem path of a fixture.
 *
 * @param file - File name inside fixtures/.
 */
function fixturePath(file: string) {
  return fileURLToPath(new URL(file, FIXTURE_DIR));
}

export { FIXTURE_DIR, METADATA_KINDS, fixturePath, fixtures };
export type { FixtureEntry };
