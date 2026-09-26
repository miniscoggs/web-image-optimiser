import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResultsTable from "../../ui/src/components/ResultsTable.js";
import type { RunFile } from "../../ui/src/runState.js";
import { suiteResult } from "./results.js";

describe("ResultsTable", () => {
  it("lists each output, and opens a finished file's comparison", () => {
    const onCompare = vi.fn();
    const result = suiteResult();
    const files: RunFile[] = [
      { ref: result.input, running: false, result },
      {
        ref: "root/spinner.png",
        running: false,
        result: {
          input: "root/spinner.png",
          status: "failed",
          outputs: [],
          warnings: [],
          error: { code: "E_ANIMATED", message: "Animated" },
        },
      },
      { ref: "root/next.png", running: true },
    ];

    render(<ResultsTable files={files} onCompare={onCompare} />);

    expect(screen.getAllByRole("row")).toHaveLength(1 + 3 + 1 + 1);
    expect(screen.getAllByRole("button", { name: /^Compare/ })).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Compare photos/cat.png" })
    );
    expect(onCompare).toHaveBeenCalledWith(result);
  });
});
