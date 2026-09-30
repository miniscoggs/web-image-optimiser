import path from "node:path";
import { verdictFor } from "../metrics/index.js";
import { outputPath } from "../pipeline/destination.js";
import { diffRequestSchema, searchRequestSchema } from "./api.js";
import type { AppDiffResponse, AppSearchResponse } from "./api.js";
import type { AppContext } from "./context.js";
import fileVersion from "./fileVersion.js";
import type { AppRoutes } from "./findRoute.js";
import { parseRequest } from "./parseRequest.js";
import { refOf, resolveRef } from "./refs.js";
import resolveOptions from "./resolveOptions.js";

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
 * Creates the routes that search a format for the smallest output reaching a target and draw
 * diff maps, both of which run in the API's pixel process and are cached for the session.
 *
 * @param context - The API's state.
 */
function createPixelRoutes(context: AppContext): AppRoutes {
  const search = async (raw: Request) => {
    const request = await parseRequest(raw, searchRequestSchema);
    const resolved = resolveOptions({ ...request, to: "suite" });
    const settings = {
      target: resolved.target,
      maxWidth: resolved.maxWidth,
      stripAll: resolved.stripAll,
      rights: resolved.rights,
    };
    const source = await resolveRef(request.file, context.refs, ["file"]);
    const key = [
      request.file,
      await fileVersion(source), // a save can replace the file
      request.format,
      JSON.stringify(settings),
    ].join("\n");
    const response = remember(
      context.searches,
      key,
      async (): Promise<AppSearchResponse> => {
        const folder = context.nextFolder("searches");
        const output = outputPath(source, request.format, folder); // named as a save names it
        const found = await context.pixels.search({
          source,
          format: request.format,
          settings,
          output,
        });

        return {
          ref: refOf(output, context.refs.session),
          format: request.format,
          method: found.method,
          ...(found.quality === undefined ? {} : { quality: found.quality }),
          bytes: found.bytes,
          saving: 1 - found.bytes / found.inputBytes,
          score: found.score,
          verdict: verdictFor(found.score),
          reached: found.score >= settings.target,
          warnings: found.warnings,
        };
      }
    );

    return Response.json(await response);
  };
  const diff = async (raw: Request) => {
    const request = await parseRequest(raw, diffRequestSchema);
    const original = await resolveRef(request.original, context.refs);
    const candidate = await resolveRef(request.candidate, context.refs);
    const key = [
      request.original,
      await fileVersion(original),
      request.candidate,
      await fileVersion(candidate),
      request.maxWidth,
    ].join("\n");
    const response = remember(
      context.diffs,
      key,
      async (): Promise<AppDiffResponse> => {
        const output = path.join(context.nextFolder("diffs"), "diff.png");

        await context.pixels.diff({
          original,
          candidate,
          maxWidth: request.maxWidth,
          output,
        });
        return { ref: refOf(output, context.refs.session) };
      }
    );

    return Response.json(await response);
  };

  return { "POST /api/search": search, "POST /api/diff": diff };
}

export default createPixelRoutes;
