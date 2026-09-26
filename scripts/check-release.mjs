// Checks a release pull request: the version must be higher than the base branch's, the lockfile
// must match it, and CHANGELOG.md must have a heading for it. CI runs it, after npm ci, when a pull
// request changes the version. Usage: node scripts/check-release.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import semver from "semver";

const BASE = "HEAD^1"; // a pull request is checked out as a merge commit onto its base branch

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const baseManifest = JSON.parse(
  execFileSync("git", ["show", `${BASE}:package.json`], { encoding: "utf8" })
);
const { version } = readJson("package.json");
const lockfile = readJson("package-lock.json");
const changelog = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
const problems = [];

if (!semver.valid(version)) {
  problems.push(`${version} is not a valid semver version`);
} else if (!semver.gt(version, baseManifest.version)) {
  problems.push(
    `${version} is not higher than the base branch's ${baseManifest.version}`
  );
}
if (lockfile.version !== version || lockfile.packages[""].version !== version) {
  problems.push(
    "package-lock.json has a different version; bump with npm version so both change"
  );
}
if (
  !changelog.some(
    (line) => line === `## ${version}` || line.startsWith(`## ${version} `)
  )
) {
  problems.push(
    `CHANGELOG.md has no "## ${version}" heading; move the Unreleased notes under one`
  );
}

for (const problem of problems) {
  console.log(`::error::${problem}`);
}
if (problems.length === 0) {
  console.log(`Release ${version} is ready`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
