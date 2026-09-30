import path from "node:path";
import { applyRights } from "../pipeline/sourceRights.js";
import writeOutputs from "../pipeline/writeOutputs.js";
import { readRights } from "../rights/index.js";
import type { ImageRights } from "../rights/index.js";
import { rightsRequestSchema } from "./api.js";
import type { AppRightsResponse } from "./api.js";
import type { AppContext } from "./context.js";
import type { AppRoutes } from "./findRoute.js";
import { parseRequest } from "./parseRequest.js";
import readImage from "./readImage.js";
import { refOf, resolveOutput, resolveRef } from "./refs.js";
import resolveOptions from "./resolveOptions.js";

/**
 * Creates the route that writes the rights fields into outputs again when the metadata options
 * change: each original's own fields with the ones given, or none with `stripAll`. It edits the
 * outputs' bytes rather than re-encoding them, and writes each into a new folder of the temp
 * folder. An SVG carries no rights, so it comes back as it is.
 *
 * @param context - The API's state.
 */
function createRightsRoute(context: AppContext): AppRoutes {
  const rights = async (raw: Request) => {
    const request = await parseRequest(raw, rightsRequestSchema);
    const settings = resolveOptions({
      stripAll: request.stripAll,
      rights: request.rights,
    });
    const folder = context.nextFolder("rights");
    const writes: { path: string; bytes: Buffer }[] = [];
    const candidates: AppRightsResponse["candidates"] = [];
    const originals = new Map<
      string,
      { inputBytes: number; own: ImageRights | undefined } // no own rights for an svg
    >(); // each read once for all its outputs

    const readOriginal = async (ref: string) => {
      const known = originals.get(ref);

      if (known !== undefined) {
        return known;
      }

      const filePath = await resolveRef(ref, context.refs, ["file"]);
      const { bytes, format } = await readImage(filePath, ref);
      const original = {
        inputBytes: bytes.length,
        own: format === "svg" ? undefined : readRights(bytes, format),
      };

      originals.set(ref, original);
      return original;
    };

    for (const [index, item] of request.candidates.entries()) {
      const { inputBytes, own } = await readOriginal(item.original);
      const candidatePath = await resolveOutput(item.candidate, context.refs);
      const candidate = await readImage(candidatePath, item.candidate);

      if (own === undefined || candidate.format === "svg") {
        candidates.push({
          ref: item.candidate,
          bytes: candidate.bytes.length,
          saving: 1 - candidate.bytes.length / inputBytes,
          larger: candidate.bytes.length > inputBytes,
          rights: {},
          rightsAdded: [],
          warnings: [],
        });
        continue;
      }

      const applied = applyRights(
        candidate.bytes,
        candidate.format,
        own,
        settings
      );
      const output = path.join(
        folder,
        String(index), // two outputs can share a name
        path.basename(candidatePath)
      );

      writes.push({ path: output, bytes: applied.bytes });
      candidates.push({
        ref: refOf(output, context.refs.session),
        bytes: applied.bytes.length,
        saving: 1 - applied.bytes.length / inputBytes,
        larger: applied.bytes.length > inputBytes,
        rights: applied.rights,
        rightsAdded: applied.rightsAdded,
        warnings: applied.warnings,
      });
    }
    await writeOutputs(writes, undefined);
    return Response.json({ candidates } satisfies AppRightsResponse);
  };

  return { "POST /api/rights": rights };
}

export default createRightsRoute;
