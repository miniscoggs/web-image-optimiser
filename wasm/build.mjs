// Rebuilds wasm/pkg inside the pinned image in wasm/Dockerfile, so no Rust toolchain is needed
// locally and the output matches the CI rebuild byte for byte. Needs a running Docker daemon.
//
// To refresh Cargo.lock after changing a dependency, run `cargo update` in the same image:
//   docker run --rm -v "<repo>/wasm:/wasm" -w /wasm <FROM image in wasm/Dockerfile> cargo update
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const wasmDir = fileURLToPath(new URL(".", import.meta.url));
const pkgDir = join(wasmDir, "pkg");
const outDir = mkdtempSync(join(tmpdir(), "wio-wasm-")); // so a failed build leaves pkg untouched

try {
  const build = spawnSync(
    "docker",
    [
      "build",
      "--platform",
      "linux/amd64", // same toolchain binaries on every host
      "--output",
      `type=local,dest=${outDir}`,
      wasmDir,
    ],
    { stdio: "inherit" }
  );

  if (build.error) {
    console.error(
      `Could not run docker (${build.error.message}). Install Docker, start it, and try again.`
    );
    process.exitCode = 1;
  } else if (build.status !== 0) {
    process.exitCode = build.status ?? 1;
  } else {
    rmSync(pkgDir, { recursive: true, force: true });
    cpSync(outDir, pkgDir, { recursive: true });
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
