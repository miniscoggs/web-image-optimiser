import { describe, expect, it } from "vitest";
import ApiError from "../../src/app/ApiError.js";
import { apiErrorSchema } from "../../src/app/api.js";
import describeFailure from "../../src/app/describeFailure.js";
import { OptimiserError } from "../../src/schema/index.js";

describe("describeFailure", () => {
  it.each([
    [
      "an ApiError, with its own status",
      new ApiError(409, "photo.webp already exists"),
      { status: 409, body: { error: "photo.webp already exists" } },
    ],
    [
      "an ApiError with a code",
      new ApiError(404, "Not an image", "E_UNSUPPORTED_FORMAT"),
      {
        status: 404,
        body: { error: "Not an image", code: "E_UNSUPPORTED_FORMAT" },
      },
    ],
    [
      "an OptimiserError, as 422 with its code",
      new OptimiserError("E_WRITE", "Couldn't write photo.webp"),
      {
        status: 422,
        body: { error: "Couldn't write photo.webp", code: "E_WRITE" },
      },
    ],
    [
      "anything else, as 500",
      new TypeError("Cannot read properties of undefined"),
      { status: 500, body: { error: "Cannot read properties of undefined" } },
    ],
    ["a thrown string", "stopped", { status: 500, body: { error: "stopped" } }],
  ])("describes %s", (_name, error, expected) => {
    const described = describeFailure(error);

    expect(described).toEqual(expected);
    expect(apiErrorSchema.parse(described.body)).toEqual(described.body);
  });
});
