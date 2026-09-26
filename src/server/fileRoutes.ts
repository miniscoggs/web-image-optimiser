import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "tinyglobby";
import { detectFormat } from "../inspect/detectFormat.js";
import MIME_TYPES from "../inspect/mimeTypes.js";
import { IMAGE_PATTERN, formatOfExtension } from "../pipeline/destination.js";
import ApiError from "./ApiError.js";
import type { ServerFilesResponse, ServerListedFile } from "./api.js";
import type { ServerContext } from "./context.js";
import fileVersion from "./fileVersion.js";
import type { ServerRoutes } from "./http.js";
import { refOf, resolveRef } from "./refs.js";
import type { ServerFolders } from "./refs.js";

const SNIFF_BYTES = 16 * 1024; // any format's signature, and an svg's prolog up to its root

const byName = new Intl.Collator(undefined, { numeric: true }).compare; // img2 before img10

/**
 * Describes files for the file list, leaving out any removed since they were found.
 *
 * @param paths - The files' paths.
 * @param folders - The server's folders.
 */
async function listFiles(
  paths: string[],
  folders: ServerFolders
): Promise<ServerListedFile[]> {
  const sorted = paths
    .map((filePath) => path.normalize(filePath))
    .toSorted(byName);
  const listed = await Promise.all(
    sorted.map(async (filePath) => {
      const stats = await stat(filePath).catch(() => undefined);

      return stats === undefined
        ? []
        : [{ ref: refOf(filePath, folders), bytes: stats.size }];
    })
  );

  return listed.flat();
}

/**
 * Lists the images in the folder served, by extension, then the uploads.
 *
 * @param folders - The server's folders.
 */
async function listImages(
  folders: ServerFolders
): Promise<ServerFilesResponse> {
  const [inRoot, uploaded] = await Promise.all([
    glob(`**/${IMAGE_PATTERN}`, {
      cwd: folders.root,
      absolute: true,
      caseSensitiveMatch: false,
      expandDirectories: false,
      followSymbolicLinks: false, // a link may lead outside the folder, which the api refuses
      ignore: ["**/node_modules/**"],
    }),
    glob("uploads/*/*", { cwd: folders.session, absolute: true, dot: true }), // an upload may be named .hero.png
  ]);

  return {
    root: folders.root,
    files: [
      ...(await listFiles(inRoot, folders)),
      ...(await listFiles(uploaded, folders)),
    ],
  };
}

/**
 * Returns an uploaded file's name without any folders, or `upload` when nothing is left.
 *
 * @param name - The name the browser sent.
 */
function uploadName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";

  return base === "" || base === "." || base === ".." ? "upload" : base;
}

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
 * Creates the routes for listing, uploading and reading images.
 *
 * @param context - The server's state.
 */
function createFileRoutes(context: ServerContext): ServerRoutes {
  return {
    "GET /api/files": async () =>
      Response.json(await listImages(context.folders)),
    "POST /api/upload": async (request) => {
      const form = await request.formData().catch(() => undefined);
      const files = (form?.getAll("file") ?? []).filter(
        (entry) => entry instanceof File
      );
      const names = files.map((file) => uploadName(file.name));
      const other = names.find((name) => formatOfExtension(name) === undefined);

      if (files.length === 0) {
        throw new ApiError(400, "Expected one or more files in a file field");
      }
      if (other !== undefined) {
        throw new ApiError(
          400,
          `Only PNG, JPEG, WebP, AVIF and SVG files can be uploaded: ${other}`
        );
      }

      const stored: ServerListedFile[] = [];

      for (const [index, file] of files.entries()) {
        const target = path.join(
          context.nextFolder("uploads"),
          names[index] ?? "upload"
        );

        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, new Uint8Array(await file.arrayBuffer()), {
          flag: "wx",
        });
        stored.push({ ref: refOf(target, context.folders), bytes: file.size });
      }
      return Response.json({ files: stored });
    },
    "GET /api/image/*": async (request, encoded) => {
      const ref = decodeRef(encoded);
      const filePath = await resolveRef(ref, context.folders);
      const headers = {
        etag: `"${await fileVersion(filePath)}"`, // so an unchanged image is a 304, not a download
        "cache-control": "no-cache",
        "content-security-policy": "sandbox", // an svg opened as a page mustn't run scripts with the session
      };

      if (request.headers.get("if-none-match") === headers.etag) {
        return new Response(null, { status: 304, headers });
      }

      const bytes = await readFile(filePath);
      const format = detectFormat(bytes.subarray(0, SNIFF_BYTES));

      if (format === undefined) {
        throw new ApiError(404, `Not an image: ${ref}`);
      }
      return new Response(bytes, {
        headers: { ...headers, "content-type": MIME_TYPES[format] },
      });
    },
  };
}

export default createFileRoutes;
