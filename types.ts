export type CellValue = string | number | boolean | null;
export type Row = Record<string, CellValue>;

export interface ExecuteSqlResult {
  rows: Row[];
  fields: string[];
  /** Rows the statement changed or returned, when the driver reports it (Bun SQL's `count`). */
  affectedRows?: number;
}

// ─── Schema introspection ─────────────────────────────────────────────────────

// Optional properties are declared without `| undefined` to match zod's
// `.exactOptional()` under the repo's exactOptionalPropertyTypes setting: absent
// is allowed, explicitly-undefined is not.

export interface TableRef {
  name: string;
  /** Owning schema/database, when the provider namespaces tables. */
  schema?: string;
  type: "table" | "view";
}

export interface ColumnDef {
  name: string;
  /** Provider-native type as displayed, e.g. `varchar(255)`. */
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string | null;
  comment?: string;
}

export interface TableSchema {
  table: TableRef;
  columns: ColumnDef[];
  primaryKey: string[];
  /** `CREATE TABLE` statement or equivalent, when the provider can produce one. */
  ddl?: string;
}

// ─── Row browsing ─────────────────────────────────────────────────────────────

export const filterOperators = ["eq", "ne", "lt", "lte", "gt", "gte", "like", "in", "isNull", "isNotNull"] as const;
export type FilterOperator = (typeof filterOperators)[number];

export interface RowFilter {
  column: string;
  op: FilterOperator;
  /** Unused by `isNull`/`isNotNull`; an array for `in`. */
  value?: CellValue | (string | number)[];
}

export interface OrderBy {
  column: string;
  direction: "asc" | "desc";
}

export interface SelectRowsRequest {
  table: string;
  /** Omit for all columns. */
  columns?: string[];
  filters?: RowFilter[];
  orderBy?: OrderBy[];
  limit: number;
  offset: number;
}

export interface SelectRowsResult {
  rows: Row[];
  fields: string[];
  /** Total matching rows ignoring limit/offset; null when the provider can't count cheaply. */
  totalCount: number | null;
  hasMore: boolean;
}

// ─── Single-row edits ─────────────────────────────────────────────────────────

/**
 * One row inserted, or one row — identified by its full primary key — updated
 * or deleted. Built into parameterized SQL by util/buildMutation.ts.
 */
export type RowMutation =
  | { kind: "insert"; table: string; values: Record<string, CellValue> }
  | { kind: "update"; table: string; key: Record<string, CellValue>; values: Record<string, CellValue> }
  | { kind: "delete"; table: string; key: Record<string, CellValue> };

export interface RowMutationResult {
  /** Rows the statement changed, when the driver reports it. */
  affectedRows: number | null;
}

// ─── Provider contract ────────────────────────────────────────────────────────

export interface DataSource {
  /**
   * Executes an SQL query.
   */
  executeSql: (_sqlQuery: string) => Promise<ExecuteSqlResult>;
  /**
   * Shows the schema for all tables in the database.
   */
  showSchema(): Promise<Record<string, string>>;

  /**
   * Lists the tables and views visible to this connection, in a database-agnostic
   * shape so callers never have to know the provider's catalog dialect.
   */
  listTables(): Promise<TableRef[]>;

  /**
   * Describes one table's columns, types, nullability and primary key.
   */
  getTableSchema(table: string): Promise<TableSchema>;

  /**
   * Reads rows with simple column selection, filtering, sorting and paging.
   *
   * Implementations must validate every identifier in the request against the
   * real schema and bind every value as a parameter — see util/buildSelect.ts.
   */
  selectRows(request: SelectRowsRequest): Promise<SelectRowsResult>;

  /**
   * Inserts, updates or deletes one row with bound parameters. Optional: a
   * provider without it has no row editing. Implementations must build the SQL
   * with util/buildMutation.ts against the real table schema. Write permission
   * (`allowWrites`) is enforced by the caller.
   */
  mutateRow?(mutation: RowMutation): Promise<RowMutationResult>;

  [Symbol.asyncDispose](): Promise<void>;
}

export interface DataSourceOptions {
  url: string;
  allowWrites: boolean;
}

export type DatabaseProviderFactory = (options: DataSourceOptions) => DataSource;
