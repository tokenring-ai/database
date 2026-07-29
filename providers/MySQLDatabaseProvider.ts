import type {
  ColumnDef,
  DataSource,
  DataSourceOptions,
  ExecuteSqlResult,
  SelectRowsRequest,
  SelectRowsResult,
  TableRef,
  TableSchema,
} from "@tokenring-ai/database/types";
import buildSelect from "@tokenring-ai/database/util/buildSelect";
import normalizeCellValue, { normalizeCount, normalizeRows } from "@tokenring-ai/database/util/normalizeCellValue";
import { SQL } from "bun";

export default class MySQLDatabaseProvider implements DataSource {
  private sql: SQL;
  /**
   * Column metadata per table. `selectRows` needs it on every call to validate
   * identifiers, and a table's shape doesn't change under us mid-session.
   */
  private schemaCache = new Map<string, TableSchema>();

  constructor(readonly options: DataSourceOptions) {
    this.sql = new SQL({
      adapter: "mysql",
      url: options.url,
    });
  }

  [Symbol.asyncDispose]() {
    return this.sql.close();
  }

  /**
   * Executes an SQL query on the MySQL database using Bun's built-in SQL client.
   */
  async executeSql(sqlQuery: string): Promise<ExecuteSqlResult> {
    const result = await this.sql.unsafe<Record<string, unknown>[]>(sqlQuery);
    const rows = normalizeRows(result);

    return {
      rows,
      fields: rows.length > 0 ? Object.keys(rows[0]!) : [],
    };
  }

  /**
   * Shows the schema for all tables in a given MySQL database.
   */
  async showSchema(): Promise<Record<string, string>> {
    const tables = await this.sql.unsafe<Record<string, unknown>[]>("SHOW TABLES");
    const schema: Record<string, string> = {};

    for (const tableRow of tables) {
      const tableName = asString(Object.values(tableRow)[0]);
      if (tableName === null) continue;
      schema[tableName] = (await this.showCreateTable(tableName)) ?? "Could not retrieve CREATE TABLE statement.";
    }

    return schema;
  }

  async listTables(): Promise<TableRef[]> {
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT TABLE_NAME, TABLE_SCHEMA, TABLE_TYPE
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME`,
    );

    return [...rows].flatMap(row => {
      const name = asString(row.TABLE_NAME);
      if (name === null) return [];
      const schema = asString(row.TABLE_SCHEMA);
      return [
        {
          name,
          ...(schema !== null ? { schema } : {}),
          type: asString(row.TABLE_TYPE) === "VIEW" ? ("view" as const) : ("table" as const),
        },
      ];
    });
  }

  async getTableSchema(table: string): Promise<TableSchema> {
    const cached = this.schemaCache.get(table);
    if (cached) return cached;

    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [table],
    );

    // information_schema columns are TEXT on some servers, so they come back as
    // Buffers just like row data does.
    const columns: ColumnDef[] = [...rows].flatMap(row => {
      const name = asString(row.COLUMN_NAME);
      if (name === null) return [];
      const comment = asString(row.COLUMN_COMMENT);
      return [
        {
          name,
          dataType: asString(row.COLUMN_TYPE) ?? "unknown",
          nullable: asString(row.IS_NULLABLE) === "YES",
          isPrimaryKey: asString(row.COLUMN_KEY) === "PRI",
          defaultValue: asString(row.COLUMN_DEFAULT),
          ...(comment ? { comment } : {}),
        },
      ];
    });

    if (columns.length === 0) {
      throw new Error(`Table "${table}" was not found in the current database`);
    }

    const tableRefs = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT TABLE_SCHEMA, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    const tableRow = [...tableRefs][0];
    const tableSchemaName = asString(tableRow?.TABLE_SCHEMA);
    const ddl = await this.showCreateTable(table);

    const schema: TableSchema = {
      table: {
        name: table,
        ...(tableSchemaName ? { schema: tableSchemaName } : {}),
        type: asString(tableRow?.TABLE_TYPE) === "VIEW" ? "view" : "table",
      },
      columns,
      primaryKey: columns.filter(column => column.isPrimaryKey).map(column => column.name),
      ...(ddl ? { ddl } : {}),
    };

    this.schemaCache.set(table, schema);
    return schema;
  }

  async selectRows(request: SelectRowsRequest): Promise<SelectRowsResult> {
    // getTableSchema throws on an unknown table, so this doubles as the table
    // identifier check before anything reaches the query string.
    const { columns } = await this.getTableSchema(request.table);
    const built = buildSelect(request, columns);

    const rawRows = await this.sql.unsafe<Record<string, unknown>[]>(built.sql, built.params);
    const countRows = await this.sql.unsafe<Record<string, unknown>[]>(built.countSql, built.countParams);
    const totalCount = normalizeCount([...countRows][0]?.total);

    // TEXT/BLOB columns arrive as Buffers and datetimes as Dates; the CellValue
    // contract (and the RPC schema enforcing it) only allows JSON primitives.
    const rows = normalizeRows(rawRows);
    return {
      rows,
      fields: built.fields,
      totalCount,
      hasMore: totalCount === null ? rows.length === built.limit : built.offset + rows.length < totalCount,
    };
  }

  private async showCreateTable(table: string): Promise<string | null> {
    try {
      const rows = await this.sql<Record<string, unknown>[]>`SHOW CREATE TABLE ${this.sql(table)}`;
      const first = [...rows][0];
      // Views report the statement under a different column.
      return asString(first?.["Create Table"]) ?? asString(first?.["Create View"]);
    } catch {
      return null;
    }
  }
}

/** Reads a driver-returned catalog value as a string, tolerating Buffers. */
function asString(value: unknown): string | null {
  const normalized = normalizeCellValue(value);
  return normalized === null ? null : String(normalized);
}
