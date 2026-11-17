import type { CellValue, ColumnDef, RowMutation, TableSchema } from "../types.ts";
import { type BoundValue, bindValueFor } from "./bindValue.ts";
import type { BuildSelectOptions } from "./buildSelect.ts";

/**
 * Turns a single-row {@link RowMutation} into parameterized SQL.
 *
 * The same rules as {@link buildSelect}: every value is a bound parameter and
 * every identifier is checked against the real schema, with no escaping
 * fallback. On top of that, UPDATE and DELETE are only built for a table with
 * a primary key, and only when the request names *exactly* that key with a
 * non-null value per column — so the WHERE clause can match one row at most.
 */

export class InvalidMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMutationError";
  }
}

export interface BuiltMutation {
  sql: string;
  params: BoundValue[];
}

export type BuildMutationOptions = Pick<BuildSelectOptions, "quoteIdentifier" | "quoteTable" | "parameterPlaceholder">;

/**
 * Column types whose values do not survive the trip to the browser unchanged
 * (bytes are decoded to text, datetimes become ISO strings, JSON is
 * re-serialized), so they can neither identify a row nor be written back.
 */
const lossyTypePattern = /(blob|binary|bytea|bit|date|time|year|interval|json|geometry|point|polygon|array|\[\])/i;

export function isLossyColumnType(dataType: string): boolean {
  return lossyTypePattern.test(dataType);
}

function backtick(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

export default function buildMutation(mutation: RowMutation, schema: TableSchema, options: BuildMutationOptions = {}): BuiltMutation {
  const quote = options.quoteIdentifier ?? backtick;
  const quoteTable = options.quoteTable ?? quote;
  const placeholder = options.parameterPlaceholder ?? (() => "?");
  const table = quoteTable(mutation.table);

  const known = new Map<string, ColumnDef>(schema.columns.map(column => [column.name, column]));
  const requireColumn = (name: string): ColumnDef => {
    const column = known.get(name);
    if (!column) throw new InvalidMutationError(`Unknown column "${name}" on table "${mutation.table}"`);
    return column;
  };

  let index = 0;
  const params: BoundValue[] = [];
  const bind = (value: CellValue, column?: ColumnDef): string => {
    params.push(bindValueFor(column, value));
    return placeholder(index++);
  };

  const valueEntries = (values: Record<string, CellValue> | undefined): [string, CellValue][] => {
    const entries = Object.entries(values ?? {});
    if (entries.length === 0) throw new InvalidMutationError(`No column values given for ${mutation.kind} on "${mutation.table}"`);
    for (const [name, value] of entries) {
      const column = requireColumn(name);
      if (value !== null && isLossyColumnType(column.dataType)) {
        throw new InvalidMutationError(`Column "${name}" (${column.dataType}) cannot be edited here; use a SQL query instead`);
      }
    }
    return entries;
  };

  const whereKey = (key: Record<string, CellValue> | undefined): string => {
    if (schema.primaryKey.length === 0) {
      throw new InvalidMutationError(`Table "${mutation.table}" has no primary key, so a single row cannot be identified`);
    }
    const given = Object.keys(key ?? {});
    const expected = new Set(schema.primaryKey);
    if (given.length !== expected.size || !given.every(name => expected.has(name))) {
      throw new InvalidMutationError(`The row key must be exactly the primary key (${schema.primaryKey.join(", ")})`);
    }
    return schema.primaryKey
      .map(name => {
        const column = requireColumn(name);
        if (isLossyColumnType(column.dataType)) {
          throw new InvalidMutationError(`Primary key column "${name}" (${column.dataType}) cannot identify a row here; use a SQL query instead`);
        }
        const value = key![name];
        if (value === null || value === undefined) throw new InvalidMutationError(`Primary key column "${name}" has no value`);
        return `${quote(name)} = ${bind(value, column)}`;
      })
      .join(" AND ");
  };

  switch (mutation.kind) {
    case "insert": {
      const entries = valueEntries(mutation.values);
      const columns = entries.map(([name]) => quote(name)).join(", ");
      const placeholders = entries.map(([name, value]) => bind(value, known.get(name))).join(", ");
      return { sql: `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`, params };
    }
    case "update": {
      const entries = valueEntries(mutation.values);
      const assignments = entries.map(([name, value]) => `${quote(name)} = ${bind(value, known.get(name))}`).join(", ");
      // SET placeholders come first, so the key's numbering continues after them.
      return { sql: `UPDATE ${table} SET ${assignments} WHERE ${whereKey(mutation.key)}`, params };
    }
    case "delete":
      return { sql: `DELETE FROM ${table} WHERE ${whereKey(mutation.key)}`, params };
  }
}
