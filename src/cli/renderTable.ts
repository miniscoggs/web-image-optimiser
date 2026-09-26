import { paint } from "./paint.js";
import type { TextStyle } from "./paint.js";

/**
 * A table column: its heading, and whether its values line up on the right, like numbers.
 */
type TableColumn = { title: string; align?: "right" };

/**
 * A table cell: plain text, or text with a style.
 */
type TableCell = string | { text: string; style: TextStyle };

/**
 * Returns a cell's text, without its style.
 *
 * @param cell - The cell, or `undefined` for an empty one.
 */
function textOf(cell: TableCell | undefined) {
  return typeof cell === "object" ? cell.text : (cell ?? "");
}

/**
 * Renders rows as a plain-text table with a bold heading, each column as wide as its widest
 * value, and no trailing spaces.
 *
 * @param columns - The columns.
 * @param rows - The rows, one cell per column.
 * @param color - Whether to add colour.
 * @returns The table's lines, each ending in a newline.
 */
function renderTable(
  columns: TableColumn[],
  rows: TableCell[][],
  color: boolean
) {
  const heading = columns.map((column): TableCell => ({
    text: column.title,
    style: "bold",
  }));
  const widths = columns.map((_column, index) =>
    Math.max(...[heading, ...rows].map((row) => textOf(row[index]).length))
  );
  const line = (cells: TableCell[]) =>
    columns
      .map((column, index) => {
        const cell = cells[index];
        const text = textOf(cell);
        const padding = " ".repeat((widths[index] ?? 0) - text.length);
        const painted =
          typeof cell === "object" ? paint(text, cell.style, color) : text; // padded outside the style so trimEnd reaches it

        return column.align === "right" ? padding + painted : painted + padding;
      })
      .join("  ")
      .trimEnd();

  return [heading, ...rows].map((row) => `${line(row)}\n`).join("");
}

export default renderTable;
export type { TableCell, TableColumn };
