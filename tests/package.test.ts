import { readFile } from "node:fs/promises";
import { minVersion, satisfies } from "semver";
import { assert, describe, expect, it } from "vitest";

type PackageManifest = {
  bin: Record<string, string>;
  exports: Record<string, Record<string, string>>;
  files: string[];
  engines: { node: string };
  devDependencies: Record<string, string>;
};

type LockedPackage = {
  dev?: boolean;
  cpu?: string[];
  engines?: { node?: string };
};

/**
 * Reads a JSON file relative to this test file.
 *
 * @param relativePath - Path from this file to the JSON file.
 */
async function readJson<T>(relativePath: string) {
  const text = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return JSON.parse(text) as T;
}

/**
 * Returns the first major version number in a semver range, eg `24` for `>=24.0.0`.
 *
 * @param range - A semver range.
 */
function majorOf(range: string) {
  return range.match(/\d+/)?.[0];
}

/**
 * Returns whether a locked package only runs on 32-bit x86, which Node 23 and later don't ship for.
 *
 * @param locked - An entry from the lockfile's `packages`.
 */
function isIa32Only(locked: LockedPackage) {
  return locked.cpu?.length === 1 && locked.cpu[0] === "ia32";
}

const manifest = await readJson<PackageManifest>("../package.json");
const lockfile = await readJson<{ packages: Record<string, LockedPackage> }>(
  "../package-lock.json"
);
const runtimePackages = Object.entries(lockfile.packages).filter(
  ([path, locked]) => path !== "" && !locked.dev && !isIa32Only(locked)
);

describe("package manifest", () => {
  it("points both bins at the same entry", () => {
    expect(manifest.bin["wio"]).toBe(manifest.bin["web-image-optimiser"]);
  });

  it("lists types first in every export", () => {
    for (const entry of Object.values(manifest.exports)) {
      expect(Object.keys(entry)[0]).toBe("types");
    }
  });

  it("publishes dist only", () => {
    expect(manifest.files).toEqual(["dist"]);
  });

  it("requires a Node version every runtime package supports", () => {
    const minimumNode = minVersion(manifest.engines.node);

    assert(minimumNode, `engines.node allows no version`);
    for (const [path, locked] of runtimePackages) {
      const range = locked.engines?.node ?? "*";

      expect(satisfies(minimumNode, range), `${path} needs Node ${range}`).toBe(
        true
      );
    }
  });

  it("tracks the engines major with @types/node", () => {
    const typesRange = manifest.devDependencies["@types/node"] ?? "";

    expect(majorOf(typesRange)).toBe(majorOf(manifest.engines.node));
  });
});
