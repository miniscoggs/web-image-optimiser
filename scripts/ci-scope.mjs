// Decides which golden tests a CI run needs, and prints them for $GITHUB_OUTPUT. A pull request
// that changes engine files runs them on Ubuntu, and a release pull request (one that changes the
// package version) on every OS, as does a manual run. Usage: node scripts/ci-scope.mjs <event>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ENGINE_PATHS = [
  "src/",
  "wasm/",
  "fixtures/",
  "tests/golden/",
  "package.json",
  "package-lock.json",
];
const EVERY_OS = [
  "ubuntu-latest",
  "windows-latest",
  "macos-latest",
  "macos-15-intel",
];
const BASE = "HEAD^1"; // a pull request is checked out as a merge commit onto its base branch

/**
 * Runs git and returns its output.
 *
 * @param {...string} args - The git arguments.
 */
function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

/**
 * Works out the scope of a pull request from what it changes.
 */
function pullRequestScope() {
  const changed = git("diff", "--name-only", BASE, "HEAD")
    .split("\n")
    .filter(Boolean);
  const baseVersion = JSON.parse(git("show", `${BASE}:package.json`)).version;
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const engine = changed.some((file) =>
    ENGINE_PATHS.some((path) => file === path || file.startsWith(path))
  );

  if (version !== baseVersion) {
    return { goldenOs: EVERY_OS, release: true };
  }
  return { goldenOs: engine ? ["ubuntu-latest"] : [], release: false };
}

const [event] = process.argv.slice(2);
let scope = { goldenOs: [], release: false }; // a push to main was tested as a pull request

if (event === "pull_request") {
  scope = pullRequestScope();
} else if (event === "workflow_dispatch") {
  scope = { goldenOs: EVERY_OS, release: false };
}

console.log(`golden-os=${JSON.stringify(scope.goldenOs)}`);
console.log(`release=${scope.release}`);
