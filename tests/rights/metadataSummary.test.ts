import { describe, expect, it } from "vitest";
import {
  IMAGE_RIGHTS_FIELD_NAMES,
  METADATA_SUMMARY,
} from "../../src/rights/index.js";

describe("METADATA_SUMMARY", () => {
  it.each(Object.values(IMAGE_RIGHTS_FIELD_NAMES))(
    "names %s as kept",
    (name) => {
      expect(METADATA_SUMMARY.kept).toContain(name);
    }
  );
});
