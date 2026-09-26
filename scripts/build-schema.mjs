// Writes the JSON Schema files for the JSON contract into dist/schema, from the zod schemas in
// src/schema/contract.ts. `npm run build` runs it after compiling; never edit the output by hand.
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  compareResultSchema,
  eventSchema,
  runResultSchema,
} from "../dist/schema/contract.js";

const OUTPUT_DIR = new URL("../dist/schema/", import.meta.url);
const SCHEMAS = {
  "run-result.schema.json": runResultSchema,
  "event.schema.json": eventSchema,
  "compare-result.schema.json": compareResultSchema,
};

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const [file, schema] of Object.entries(SCHEMAS)) {
  // input mode leaves objects open, so a consumer's validator accepts fields added later
  const jsonSchema = z.toJSONSchema(schema, { io: "input" });

  writeFileSync(
    new URL(file, OUTPUT_DIR),
    `${JSON.stringify(jsonSchema, null, 2)}\n`
  );
}
