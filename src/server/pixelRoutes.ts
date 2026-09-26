import path from "node:path";
import { verdictFor } from "../metrics/index.js";
import { outputPath } from "../pipeline/destination.js";
import type { PipelineWarning } from "../pipeline/index.js";
import { diffRequestSchema, encodeRequestSchema } from "./api.js";
import type { ServerDiffResponse, ServerEncodeResponse } from "./api.js";
import type { ServerContext } from "./context.js";
import fileVersion from "./fileVersion.js";
import type { ServerRoutes } from "./http.js";
import parseRequest from "./parseRequest.js";
import { refOf, resolveRef } from "./refs.js";

const DOWNSCALED: PipelineWarning = {
  code: "W_SCORED_DOWNSCALED",
  message:
    "The image is over 26 megapixels, so it was scored at 26 MP and the score is approximate",
};

/**
 * Returns a cached value, or makes and caches it. A failure isn't kept, so it is retried.
 *
 * @param cache - The cache.
 * @param key - The value's key.
 * @param make - Makes the value.
 */
function remember<Value>(
  cache: Map<string, Promise<Value>>,
  key: string,
  make: () => Promise<Value>
) {
  let value = cache.get(key);

  if (value === undefined) {
    value = make();
    cache.set(key, value);
    void value.catch(() => cache.delete(key));
  }
  return value;
}

/**
 * Creates the routes that re-encode an image at a quality and draw diff maps, both of which
 * run on the server's pixel worker and are cached for the session.
 *
 * @param context - The server's state.
 */
function createPixelRoutes(context: ServerContext): ServerRoutes {
  const encode = async (raw: Request) => {
    const request = await parseRequest(raw, encodeRequestSchema);
    const source = await resolveRef(request.file, context.folders);
    const key = [
      request.file,
      await fileVersion(source), // a write can replace the file
      request.format,
      request.quality,
    ].join("\n");
    const response = remember(
      context.encodes,
      key,
      async (): Promise<ServerEncodeResponse> => {
        const folder = context.nextFolder("encodes");
        const output = outputPath(source, request.format, folder); // named like the source, for a download
        const encoded = await context.pixels.encode({
          source,
          format: request.format,
          quality: request.quality,
          output,
        });

        return {
          ref: refOf(output, context.folders),
          format: request.format,
          quality: request.quality,
          bytes: encoded.bytes,
          saving: 1 - encoded.bytes / encoded.inputBytes,
          score: encoded.score,
          verdict: verdictFor(encoded.score),
          warnings: encoded.downscaled ? [DOWNSCALED] : [],
        };
      }
    );

    return Response.json(await response);
  };
  const diff = async (raw: Request) => {
    const request = await parseRequest(raw, diffRequestSchema);
    const original = await resolveRef(request.original, context.folders);
    const candidate = await resolveRef(request.candidate, context.folders);
    const key = [
      request.original,
      await fileVersion(original),
      request.candidate,
      await fileVersion(candidate),
    ].join("\n");
    const response = remember(
      context.diffs,
      key,
      async (): Promise<ServerDiffResponse> => {
        const output = path.join(context.nextFolder("diffs"), "diff.png");

        await context.pixels.diff({ original, candidate, output });
        return { ref: refOf(output, context.folders) };
      }
    );

    return Response.json(await response);
  };

  return { "POST /api/encode": encode, "POST /api/diff": diff };
}

export default createPixelRoutes;
