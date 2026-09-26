import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  compareResultSchema,
  eventSchema,
  fileResultSchema,
  runResultSchema,
} from "../../src/schema/contract.js";
import { ERROR_CODES, WARNING_CODES } from "../../src/schema/index.js";

describe("JSON contract", () => {
  it("generates JSON Schema that accepts fields added later", () => {
    for (const schema of [runResultSchema, eventSchema, compareResultSchema]) {
      const text = JSON.stringify(z.toJSONSchema(schema, { io: "input" }));

      expect(text).not.toContain('"additionalProperties":false');
    }
  });

  it("lists every error and warning code", () => {
    const text = JSON.stringify(
      z.toJSONSchema(fileResultSchema, { io: "input" })
    );

    expect(text).toContain(JSON.stringify([...ERROR_CODES]));
    expect(text).toContain(JSON.stringify([...WARNING_CODES]));
  });

  it("rejects a result with a field of the wrong shape", () => {
    const result = {
      input: "a.png",
      status: "done",
      outputs: [],
      warnings: [],
    };

    expect(fileResultSchema.safeParse(result).success).toBe(false);
  });
});
