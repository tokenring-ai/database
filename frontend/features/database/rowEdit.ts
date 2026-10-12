import { isLossyColumnType } from "../../../util/buildMutation.ts";
import { isNumericType } from "./constants.ts";
import { coerceScalar } from "./filterQuery.ts";
import type { CellValue, ColumnDef, Row } from "./types.ts";

export { isLossyColumnType };

/** One form field: the text being edited, or NULL. `touched` marks a field the user changed. */
export interface FieldDraft {
  text: string;
  isNull: boolean;
  touched: boolean;
}

export type RowDraft = Record<string, FieldDraft>;

/**
 * Why the rows of a table cannot be updated or deleted from the grid, or null
 * when they can. The server re-checks all of this (rpc mutateRow + util/buildMutation.ts).
 */
export function rowEditBlockReason(allowWrites: boolean, columns: ColumnDef[], primaryKey: string[]): string | null {
  if (!allowWrites) return "This datasource is read-only.";
  if (primaryKey.length === 0) return "This table has no primary key, so a single row cannot be identified. Use a SQL query instead.";
  const lossy = primaryKey.find(name => {
    const column = columns.find(entry => entry.name === name);
    return !column || isLossyColumnType(column.dataType);
  });
  if (lossy) return `The primary key column "${lossy}" cannot identify a row here. Use a SQL query instead.`;
  return null;
}

export function draftFromRow(row: Row | null, columns: ColumnDef[]): RowDraft {
  const draft: RowDraft = {};
  for (const column of columns) {
    const value = row ? (row[column.name] ?? null) : null;
    draft[column.name] = {
      text: value === null ? "" : String(value),
      // A new row starts with every field unset (the database default), not NULL.
      isNull: row !== null && value === null,
      touched: false,
    };
  }
  return draft;
}

/** The full primary key of a row, as the server expects it. */
export function rowKey(row: Row, primaryKey: string[]): Record<string, CellValue> {
  return Object.fromEntries(primaryKey.map(name => [name, row[name] ?? null]));
}

/**
 * The column values to send: only fields the user changed, coerced to the
 * column's type. Fields that fail coercion are reported instead.
 */
export function draftToValues(draft: RowDraft, columns: ColumnDef[]): { values: Record<string, CellValue>; errors: Record<string, string> } {
  const values: Record<string, CellValue> = {};
  const errors: Record<string, string> = {};
  for (const column of columns) {
    const field = draft[column.name];
    if (!field?.touched) continue;
    if (field.isNull) {
      if (!column.nullable) errors[column.name] = "This column cannot be NULL.";
      else values[column.name] = null;
      continue;
    }
    if (isNumericType(column.dataType) && field.text.trim() === "") {
      errors[column.name] = column.nullable ? "Enter a number, or set NULL." : "Enter a number.";
      continue;
    }
    const coerced = coerceScalar(field.text, column.dataType);
    if (coerced === null) {
      errors[column.name] = "Not a number.";
      continue;
    }
    values[column.name] = coerced;
  }
  return { values, errors };
}
