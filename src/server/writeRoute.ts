import { readFile } from "node:fs/promises";
import {
  formatOfExtension,
  outputPath,
  planWrites,
} from "../pipeline/destination.js";
import readInput from "../pipeline/readInput.js";
import writeOutputs from "../pipeline/writeOutputs.js";
import ApiError from "./ApiError.js";
import { writeRequestSchema } from "./api.js";
import type { ServerWriteResponse } from "./api.js";
import type { ServerContext } from "./context.js";
import type { ServerRoutes } from "./http.js";
import parseRequest from "./parseRequest.js";
import { refOf, resolveRef } from "./refs.js";

const ORIGINALS = ["root/", "session/uploads/"];
const CANDIDATES = ["session/runs/", "session/encodes/"]; // named by outputPath, so their extensions are their formats

/**
 * Returns whether a ref starts with one of some prefixes.
 *
 * @param ref - The ref.
 * @param prefixes - The prefixes.
 */
function startsWithAny(ref: string, prefixes: string[]) {
  return prefixes.some((prefix) => ref.startsWith(prefix));
}

/**
 * Creates the route that saves a run's output or a re-encode into the folder served, the only
 * way the server changes it. It keeps the CLI's safety rules: nothing larger than the original,
 * the original replaced only with `inPlace`, another file only with `overwrite`, and every write
 * atomic.
 *
 * @param context - The server's state.
 */
function createWriteRoute(context: ServerContext): ServerRoutes {
  const write = async (raw: Request) => {
    const request = await parseRequest(raw, writeRequestSchema);

    if (!startsWithAny(request.original, ORIGINALS)) {
      throw new ApiError(400, `Not an image to optimise: ${request.original}`);
    }
    if (!startsWithAny(request.candidate, CANDIDATES)) {
      throw new ApiError(
        400,
        `Only a run's outputs and re-encodes can be written: ${request.candidate}`
      );
    }

    const originalPath = await resolveRef(request.original, context.folders);
    const candidatePath = await resolveRef(request.candidate, context.folders);
    const format = formatOfExtension(candidatePath);

    if (format === undefined) {
      throw new ApiError(400, `Not an image: ${request.candidate}`);
    }

    const [input, bytes] = await Promise.all([
      readInput(originalPath),
      readFile(candidatePath),
    ]);

    if (bytes.length > input.bytes.length) {
      throw new ApiError(
        422,
        "The image is larger than the original, and wio never writes an output larger than its input"
      );
    }

    const outDir = request.original.startsWith("root/")
      ? undefined
      : context.folders.root; // an upload's output goes in the folder served
    const target = outputPath(originalPath, format, outDir);
    const plan = await planWrites([{ path: target, bytes }], input, {
      inPlace: request.inPlace ?? false,
      overwrite: request.overwrite ?? false,
    });
    const ref = refOf(target, context.folders);

    if ("blocked" in plan) {
      return Response.json({
        ref,
        outcome: plan.blocked.reason,
      } satisfies ServerWriteResponse);
    }
    if (plan.writes.length === 0) {
      return Response.json({
        ref,
        outcome: "unchanged",
      } satisfies ServerWriteResponse);
    }
    await writeOutputs(plan.writes, undefined);
    return Response.json({
      ref,
      outcome: "written",
    } satisfies ServerWriteResponse);
  };

  return { "POST /api/write": write };
}

export default createWriteRoute;
