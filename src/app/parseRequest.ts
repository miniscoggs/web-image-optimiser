import { z } from "zod";
import ApiError from "./ApiError.js";

/**
 * Checks a value against a schema.
 *
 * @param value - The value, such as a request's body.
 * @param schema - The schema.
 * @returns The value, as the schema parses it.
 * @throws {@link ApiError} 400 when it doesn't match.
 */
function parseValue<Schema extends z.ZodType>(
  value: unknown,
  schema: Schema
): z.infer<Schema> {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new ApiError(
      400,
      `The request isn't valid: ${z.prettifyError(parsed.error)}`
    );
  }
  return parsed.data;
}

/**
 * Reads a request's JSON body and checks it against a schema.
 *
 * @param request - The request.
 * @param schema - The schema.
 * @returns The body, as the schema parses it.
 * @throws {@link ApiError} 415 without a JSON content type, and 400 when the body isn't JSON or
 * doesn't match.
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

  return parseValue(body, schema);
}

export { parseRequest, parseValue };
