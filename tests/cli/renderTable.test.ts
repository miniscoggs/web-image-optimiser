import { describe, expect, it } from "vitest";
import renderTable from "../../src/cli/renderTable.js";

describe("renderTable", () => {
  it("sizes each column to its widest value, aligns numbers right and trims each line", () => {
    const table = renderTable(
      [{ title: "File" }, { title: "Size", align: "right" }],
      [
        ["photo.jpg", "1.2 MB"],
        ["a.png", { text: "80 kB", style: "green" }],
      ],
      false
    );

    expect(table).toBe(
      "File         Size\nphoto.jpg  1.2 MB\na.png       80 kB\n"
    );
  });

  it("renders a table of very many rows", () => {
    const rows = Array.from({ length: 130_000 }, (_value, index) => [
      `${index}.png`,
    ]); // V8 overflows its stack spreading 125,000 or more arguments

    const table = renderTable([{ title: "File" }], rows, false);

    expect(table.split("\n")).toHaveLength(130_002);
  });
});
