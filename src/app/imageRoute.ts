import MIME_TYPES from "../inspect/mimeTypes.js";
import ApiError from "./ApiError.js";
import type { AppContext } from "./context.js";
import fileVersion from "./fileVersion.js";
import type { AppRoutes } from "./findRoute.js";
import readImage from "./readImage.js";
import { resolveRef } from "./refs.js";

/**
 * Decodes the ref in an image's address.
 *
 * @param encoded - The ref, URL-encoded as one path segment.
 * @throws {@link ApiError} 400 when it isn't valid URL encoding.
 */
function decodeRef(encoded: string) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new ApiError(400, `Not a file reference: ${encoded}`);
  }
}

/**
 * Creates the route that serves an image by its ref.
 *
 * @param context - The API's state.
 */
function createImageRoute(context: AppContext): AppRoutes {
  return {
    "GET /api/image/*": async (request, encoded) => {
      const ref = decodeRef(encoded);
      const filePath = await resolveRef(ref, context.refs);
      const headers = {
        etag: `"${await fileVersion(filePath)}"`, // so an unchanged image is a 304, not a download
        "cache-control": "no-cache",
        "content-security-policy": "sandbox", // an svg opened as a page mustn't run scripts
      };

      if (request.headers.get("if-none-match") === headers.etag) {
        return new Response(null, { status: 304, headers });
      }

      const { bytes, format } = await readImage(filePath, ref);

      return new Response(bytes, {
        headers: { ...headers, "content-type": MIME_TYPES[format] },
      });
    },
  };
}

export default createImageRoute;
