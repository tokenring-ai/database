import { MAX_ROW_LIMIT } from "../schema.ts";
import type { CellValue, ColumnDef, FilterOperator, SelectRowsRequest } from "../types.ts";

/**
 * Turns a {@link SelectRowsRequest} into parameterized SQL.
 *
 * Values are always bound as parameters. Identifiers cannot be bound in SQL, so
 * every table, column and sort column is checked against the real schema the
 * caller passes in and rejected outright when it doesn't match — there is
 * deliberately no escaping fallback for a name that failed validation, because
 * an unrecognized identifier means the caller is confused or hostile either way.
 */

export class InvalidSelectRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSelectRequestError";
  }
}

export interface BuiltSelect {
  /** `SELECT ... FROM ... [WHERE ...] [ORDER BY ...] LIMIT ? OFFSET ?` */
  sql: string;
  params: CellValue[];
  /** `SELECT COUNT(*) AS total FROM ... [WHERE ...]` — same filters, no paging. */
  countSql: string;
  countParams: CellValue[];
  /** Columns actually selected, in order. */
  fields: string[];
  /** The clamped limit that ended up in the query. */
  limit: number;
  offset: number;
}

export interface BuildSelectOptions {
  /** How the dialect quotes an identifier. Defaults to MySQL backticks. */
  quoteIdentifier?: (name: string) => string;
}

/** MySQL/MariaDB backtick quoting. The name is already validated; this is belt-and-braces. */
function backtick(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

const operatorSql: Record<Exclude<FilterOperator, "in" | "isNull" | "isNotNull">, string> = {
  eq: "=",
  ne: "<>",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
  like: "LIKE",
};

export default function buildSelect(request: SelectRowsRequest, columns: ColumnDef[], options: BuildSelectOptions = {}): BuiltSelect {
  const quote = options.quoteIdentifier ?? backtick;

  if (columns.length === 0) {
    throw new InvalidSelectRequestError(`Table "${request.table}" has no columns`);
  }

  const known = new Map(columns.map(column => [column.name, column]));
  const requireColumn = (name: string, what: string): string => {
    if (!known.has(name)) {
      throw new InvalidSelectRequestError(`Unknown ${what} "${name}" on table "${request.table}". Available: ${columns.map(c => c.name).join(", ")}`);
    }
    return name;
  };

  const fields = request.columns?.length ? request.columns.map(name => requireColumn(name, "column")) : columns.map(column => column.name);

  const selectList = fields.map(quote).join(", ");
  const from = quote(request.table);

  // ─── WHERE ───
  const conditions: string[] = [];
  const whereParams: CellValue[] = [];

  for (const filter of request.filters ?? []) {
    const column = quote(requireColumn(filter.column, "filter column"));

    switch (filter.op) {
      case "isNull":
        conditions.push(`${column} IS NULL`);
        break;
      case "isNotNull":
        conditions.push(`${column} IS NOT NULL`);
        break;
      case "in": {
        const values = Array.isArray(filter.value) ? filter.value : filter.value === undefined ? [] : [filter.value as string | number];
        if (values.length === 0) {
          // `IN ()` is a syntax error, and an empty set matches nothing.
          conditions.push("1 = 0");
          break;
        }
        conditions.push(`${column} IN (${values.map(() => "?").join(", ")})`);
        whereParams.push(...values);
        break;
      }
      default: {
        if (filter.value === undefined) {
          throw new InvalidSelectRequestError(`Filter "${filter.column} ${filter.op}" requires a value`);
        }
        if (Array.isArray(filter.value)) {
          throw new InvalidSelectRequestError(`Filter "${filter.column} ${filter.op}" takes a single value, not a list`);
        }
        conditions.push(`${column} ${operatorSql[filter.op]} ?`);
        whereParams.push(filter.value);
        break;
      }
    }
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

  // ─── ORDER BY ───
  const orderBy = (request.orderBy ?? []).map(order => `${quote(requireColumn(order.column, "sort column"))} ${order.direction === "desc" ? "DESC" : "ASC"}`);
  const orderByClause = orderBy.length > 0 ? ` ORDER BY ${orderBy.join(", ")}` : "";

  // ─── Paging ───
  // Clamped here rather than trusted from the caller: the tool and the RPC both
  // reach this function, and a runaway limit is the difference between a page
  // and pulling a whole table into agent context.
  const limit = Math.min(Math.max(1, Math.trunc(request.limit)), MAX_ROW_LIMIT);
  const offset = Math.max(0, Math.trunc(request.offset));

  return {
    sql: `SELECT ${selectList} FROM ${from}${where}${orderByClause} LIMIT ? OFFSET ?`,
    params: [...whereParams, limit, offset],
    countSql: `SELECT COUNT(*) AS total FROM ${from}${where}`,
    countParams: [...whereParams],
    fields,
    limit,
    offset,
  };
}
