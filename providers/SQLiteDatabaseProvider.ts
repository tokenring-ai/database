import type {
  ColumnDef,
  DataSource,
  DataSourceOptions,
  ExecuteSqlResult,
  RowMutation,
  RowMutationResult,
  SelectRowsRequest,
  SelectRowsResult,
  TableRef,
  TableSchema,
} from "@tokenring-ai/database/types";
import buildMutation from "@tokenring-ai/database/util/buildMutation";
import buildSelect, { doubleQuoteIdentifier } from "@tokenring-ai/database/util/buildSelect";
import normalizeCellValue, { normalizeCount, normalizeRows } from "@tokenring-ai/database/util/normalizeCellValue";
import { SQL } from "bun";
import isReadOnlyQuery from "../util/isReadOnlyQuery.ts";
import { isReadOnlyViolation, ReadOnlyViolationError } from "../util/readOnlyViolation.ts";
import { SchemaCache } from "../util/SchemaCache.ts";

/**
 * Maps a connection string to a path Bun's SQLite adapter understands.
 *
 * Accepts the forms Bun documents plus a few convenient aliases:
 * - `:memory:`, `sqlite::memory:`, `sqlite://:memory:`, `sqlite:///:memory:`
 * - `sqlite:///abs/path.db`, `file:///abs/path.db`
 * - `sqlite://./rel/path.db`, bare paths
 */
export function sqliteFilenameFromUrl(url: string): string {
  const trimmed = url.trim();

  if (
    trimmed === ":memory:" ||
    trimmed === "sqlite::memory:" ||
    trimmed === "sqlite://:memory:" ||
    trimmed === "sqlite:///:memory:" ||
    trimmed === "file::memory:" ||
    trimmed === "file://:memory:"
  ) {
    return ":memory:";
  }

  // WHATWG URL parses most forms; sqlite://:memory: is rejected and handled above.
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "sqlite:" || parsed.protocol === "file:") {
      if (parsed.pathname === "/:memory:") return ":memory:";

      // sqlite://./path/to.db → hostname ".", pathname "/path/to.db"
      if (parsed.hostname === ".") {
        return `.${decodeURIComponent(parsed.pathname)}`;
      }

      // sqlite://relative.db (hostname only, empty or "/" path)
      if (parsed.hostname && parsed.hostname !== "localhost") {
        const rest = parsed.pathname === "/" ? "" : decodeURIComponent(parsed.pathname);
        return `${parsed.hostname}${rest}`;
      }

      // file:///abs or sqlite:///abs → pathname is the absolute path
      const path = decodeURIComponent(parsed.pathname);
      return path === "" ? ":memory:" : path;
    }
  } catch {
    // Fall through to prefix stripping.
  }

  if (trimmed.startsWith("sqlite:")) {
    let rest = trimmed.slice("sqlite:".length);
    // sqlite:///abs  or  sqlite://rel  or  sqlite:/abs
    if (rest.startsWith("//")) rest = rest.slice(2);
    if (rest === ":memory:") return ":memory:";
    // Leading single slash after stripping // means absolute path kept as-is
    // when it was sqlite:///… (rest starts with /).
    return rest || ":memory:";
  }

  if (trimmed.startsWith("file:")) {
    let rest = trimmed.slice("file:".length);
    if (rest.startsWith("//")) rest = rest.slice(2);
    // file:///tmp/x → after stripping // we still have /tmp/x when original
    // had three slashes… actually file:///tmp → rest after file: is ///tmp,
    // after // strip once: /tmp. Good.
    // Wait: file:///tmp → slice file: → ///tmp → slice // → /tmp. Correct.
    return rest || ":memory:";
  }

  return trimmed;
}

export default class SQLiteDatabaseProvider implements DataSource {
  private sql: SQL;
  private schemaCache = new SchemaCache();

  constructor(readonly options: DataSourceOptions) {
    this.sql = new SQL({
      adapter: "sqlite",
      filename: sqliteFilenameFromUrl(options.url),
      // Integers come back as bigint so values past 2^53 stay exact; normalizeCellValue turns
      // safe ones back into numbers and the rest into digit strings.
      safeIntegers: true,
    });
  }

  [Symbol.asyncDispose]() {
    return this.sql.close();
  }

  /**
   * SQLite has one connection, and query_only applies to all of it: statements run one at a time,
   * so no other statement runs while it is switched on (or slips past while it is off).
   */
  private queue: Promise<unknown> = Promise.resolve();

  private serialized<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async executeSql(sqlQuery: string, { readOnly = false }: { readOnly?: boolean } = {}): Promise<ExecuteSqlResult> {
    // DDL (ALTER TABLE, DROP…) changes what the cached table schemas describe.
    if (!isReadOnlyQuery(sqlQuery)) this.schemaCache.clear();
    const result = await this.serialized(async () => {
      if (!readOnly) return this.sql.unsafe<Record<string, unknown>[]>(sqlQuery);
      await this.sql.unsafe("PRAGMA query_only = ON");
      try {
        return await this.sql.unsafe<Record<string, unknown>[]>(sqlQuery);
      } catch (error) {
        throw isReadOnlyViolation(error) ? new ReadOnlyViolationError(error) : error;
      } finally {
        await this.sql.unsafe("PRAGMA query_only = OFF");
      }
    });
    const rows = normalizeRows(result);
    const affectedRows = (result as { count?: unknown }).count;

    return {
      rows,
      fields: rows.length > 0 ? Object.keys(rows[0]!) : [],
      ...(typeof affectedRows === "number" ? { affectedRows } : {}),
    };
  }

  async showSchema(): Promise<Record<string, string>> {
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT name, sql
         FROM sqlite_master
        WHERE type IN ('table', 'view')
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    );

    const schema: Record<string, string> = {};
    for (const row of rows) {
      const name = asString(row.name);
      if (name === null) continue;
      schema[name] = asString(row.sql) ?? "Could not retrieve CREATE statement.";
    }
    return schema;
  }

  async listTables(): Promise<TableRef[]> {
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT name, type
         FROM sqlite_master
        WHERE type IN ('table', 'view')
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    );

    return [...rows].flatMap(row => {
      const name = asString(row.name);
      if (name === null) return [];
      return [
        {
          name,
          type: asString(row.type) === "view" ? ("view" as const) : ("table" as const),
        },
      ];
    });
  }

  async getTableSchema(table: string): Promise<TableSchema> {
    const cached = this.schemaCache.get(table);
    if (cached) return cached;

    // Table-valued PRAGMA form accepts a bound parameter (unlike PRAGMA table_info(name)).
    const columnRows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT cid, name, type, "notnull", dflt_value, pk
         FROM pragma_table_info($1)
        ORDER BY cid`,
      [table],
    );

    const columns: ColumnDef[] = [...columnRows].flatMap(row => {
      const name = asString(row.name);
      if (name === null) return [];
      const dataType = asString(row.type);
      return [
        {
          name,
          // SQLite is dynamically typed; report the declared affinity/type from the schema.
          dataType: dataType && dataType.length > 0 ? dataType : "NUMERIC",
          nullable: !isTruthyFlag(row.notnull),
          isPrimaryKey: isTruthyFlag(row.pk),
          defaultValue: asString(row.dflt_value),
        },
      ];
    });

    if (columns.length === 0) {
      throw new Error(`Table "${table}" was not found in the current database`);
    }

    const metaRows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT type, sql FROM sqlite_master WHERE name = $1 AND type IN ('table', 'view') LIMIT 1`,
      [table],
    );
    const meta = [...metaRows][0];
    const ddl = asString(meta?.sql);

    const schema: TableSchema = {
      table: {
        name: table,
        type: asString(meta?.type) === "view" ? "view" : "table",
      },
      columns,
      primaryKey: columns.filter(column => column.isPrimaryKey).map(column => column.name),
      ...(ddl ? { ddl } : {}),
    };

    this.schemaCache.set(table, schema);
    return schema;
  }

  async mutateRow(mutation: RowMutation): Promise<RowMutationResult> {
    const schema = await this.getTableSchema(mutation.table);
    const built = buildMutation(mutation, schema, { quoteIdentifier: doubleQuoteIdentifier });
    const result = await this.sql.unsafe<Record<string, unknown>[]>(built.sql, built.params);
    const count = (result as { count?: unknown }).count;
    return { affectedRows: typeof count === "number" ? count : null };
  }

  async selectRows(request: SelectRowsRequest): Promise<SelectRowsResult> {
    const { columns } = await this.getTableSchema(request.table);
    const built = buildSelect(request, columns, {
      quoteIdentifier: doubleQuoteIdentifier,
      // Bun's SQLite client accepts both `?` and `$n`; stick to `?` to match
      // the MySQL path and the brainstorm.
    });

    const rawRows = await this.sql.unsafe<Record<string, unknown>[]>(built.sql, built.params);
    const countRows = await this.sql.unsafe<Record<string, unknown>[]>(built.countSql, built.countParams);
    const totalCount = normalizeCount([...countRows][0]?.total);

    const rows = normalizeRows(rawRows);
    return {
      rows,
      fields: built.fields,
      totalCount,
      hasMore: totalCount === null ? rows.length === built.limit : built.offset + rows.length < totalCount,
    };
  }
}

/** SQLite PRAGMA flags come back as 0/1 integers (sometimes bigint). */
function isTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "bigint") return value !== 0n;
  if (typeof value === "string") return value !== "0" && value !== "";
  return false;
}

function asString(value: unknown): string | null {
  const normalized = normalizeCellValue(value);
  return normalized === null ? null : String(normalized);
}
