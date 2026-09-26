import { z } from "zod";
import ApiError from "./ApiError.js";

/**
 * Reads a request's JSON body and checks it against a schema.
 *
 * @param request - The request.
 * @param schema - The schema.
 * @returns The body, as the schema parses it.
 * @throws {@link ApiError} 415 without a JSON content type, which another page can't send
 * without the browser asking the server first, and 400 when the body isn't JSON or doesn't
 * match.
 */
async function parseRequest<Schema extends z.ZodType>(
  request: Request,
  schema: Schema
): Promise<z.infer<Schema>> {
  if (
    !/^application\/json\b/i.test(request.headers.get("content-type") ?? "")
  ) {
    throw new ApiError(415, "Expected a JSON body, sent as application/json");
  }

  const body: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new ApiError(
      400,
      `The request isn't valid: ${z.prettifyError(parsed.error)}`
    );
  }
  return parsed.data;
}

export default parseRequest;
