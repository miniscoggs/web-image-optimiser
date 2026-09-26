import { describe, expect, it, vi } from "vitest";

vi.doMock("../../src/pipeline/optimiseFile.js", () => ({
  default: () => Promise.reject(new Error("an unexpected bug")),
}));

const { optimiseBatch } = await import("../../src/pipeline/index.js");

describe("optimiseBatch when a file hits an unexpected error", () => {
  it("fails that file with E_INTERNAL and carries on", async () => {
    const result = await optimiseBatch(["one.png", "two.png"], {
      dryRun: true,
    });

    expect(result.files).toEqual([
      expect.objectContaining({
        status: "failed",
        error: { code: "E_INTERNAL", message: "an unexpected bug" },
      }),
      expect.objectContaining({ input: "two.png", status: "failed" }),
    ]);
    expect(result.totals.failed).toBe(2);
  });
});
