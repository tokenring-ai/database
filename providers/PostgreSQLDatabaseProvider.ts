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
import buildSelect, { dollarPlaceholder, doubleQuoteIdentifier } from "@tokenring-ai/database/util/buildSelect";
import normalizeCellValue, { normalizeCount, normalizeRows } from "@tokenring-ai/database/util/normalizeCellValue";
import { formatTableRef, parseTableRef } from "@tokenring-ai/database/util/tableRef";
import { SQL } from "bun";

/** Quotes a resolved table ref. Schema and name are quoted separately so a dot inside either stays inside its identifier. */
function quotedQualifiedTable(table: TableRef): string {
  return table.schema ? `${doubleQuoteIdentifier(table.schema)}.${doubleQuoteIdentifier(table.name)}` : doubleQuoteIdentifier(table.name);
}

export default class PostgreSQLDatabaseProvider implements DataSource {
  private sql: SQL;
  /**
   * Column metadata per table key (`schema.name` or bare name). `selectRows`
   * needs it on every call to validate identifiers.
   */
  private schemaCache = new Map<string, TableSchema>();

  constructor(readonly options: DataSourceOptions) {
    this.sql = new SQL({
      adapter: "postgres",
      url: options.url,
    });
  }

  [Symbol.asyncDispose]() {
    return this.sql.close();
  }

  async executeSql(sqlQuery: string): Promise<ExecuteSqlResult> {
    const result = await this.sql.unsafe<Record<string, unknown>[]>(sqlQuery);
    const rows = normalizeRows(result);
    const affectedRows = (result as { count?: unknown }).count;

    return {
      rows,
      fields: rows.length > 0 ? Object.keys(rows[0]!) : [],
      ...(typeof affectedRows === "number" ? { affectedRows } : {}),
    };
  }

  async showSchema(): Promise<Record<string, string>> {
    const tables = await this.listTables();
    const schema: Record<string, string> = {};

    for (const table of tables) {
      const key = formatTableRef(table);
      try {
        const tableSchema = await this.getTableSchema(key);
        schema[key] = tableSchema.ddl ?? synthesizeCreateTable(tableSchema);
      } catch {
        schema[key] = "Could not retrieve table definition.";
      }
    }

    return schema;
  }

  async listTables(): Promise<TableRef[]> {
    // Exclude system catalogs; include every user schema the role can see.
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT table_schema, table_name, table_type
         FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          AND table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY table_schema, table_name`,
    );

    return [...rows].flatMap(row => {
      const name = asString(row.table_name);
      if (name === null) return [];
      const schema = asString(row.table_schema);
      return [
        {
          name,
          ...(schema !== null ? { schema } : {}),
          type: asString(row.table_type) === "VIEW" ? ("view" as const) : ("table" as const),
        },
      ];
    });
  }

  async getTableSchema(table: string): Promise<TableSchema> {
    const cached = this.schemaCache.get(table);
    if (cached) return cached;

    const resolved = await this.resolveTable(table);
    const cacheKey = `${resolved.schema}.${resolved.name}`;
    const cachedResolved = this.schemaCache.get(cacheKey);
    if (cachedResolved) {
      this.schemaCache.set(table, cachedResolved);
      return cachedResolved;
    }

    // pg_catalog gives display types via format_type (e.g. character varying(255),
    // jsonb, uuid[]) and primary-key membership without joining constraint tables.
    const columnRows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT
          a.attname AS column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
          NOT a.attnotnull AS is_nullable,
          pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default,
          col_description(a.attrelid, a.attnum) AS column_comment,
          EXISTS (
            SELECT 1
              FROM pg_catalog.pg_index i
             WHERE i.indrelid = a.attrelid
               AND i.indisprimary
               AND a.attnum = ANY (i.indkey)
          ) AS is_primary_key
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_catalog.pg_attrdef d
           ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = $1
          AND c.relname = $2
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [resolved.schema, resolved.name],
    );

    const columns: ColumnDef[] = [...columnRows].flatMap(row => {
      const name = asString(row.column_name);
      if (name === null) return [];
      const comment = asString(row.column_comment);
      return [
        {
          name,
          dataType: asString(row.data_type) ?? "unknown",
          nullable: row.is_nullable === true || asString(row.is_nullable) === "t" || asString(row.is_nullable) === "true",
          isPrimaryKey: row.is_primary_key === true || asString(row.is_primary_key) === "t" || asString(row.is_primary_key) === "true",
          defaultValue: asString(row.column_default),
          ...(comment ? { comment } : {}),
        },
      ];
    });

    if (columns.length === 0) {
      throw new Error(`Table "${table}" was not found in the current database`);
    }

    const primaryKey = columns.filter(column => column.isPrimaryKey).map(column => column.name);
    const base: TableSchema = {
      table: {
        name: resolved.name,
        schema: resolved.schema,
        type: resolved.type,
      },
      columns,
      primaryKey,
    };
    const ddl = resolved.type === "view" ? await this.getViewDefinition(resolved.schema, resolved.name) : synthesizeCreateTable(base);

    const tableSchema: TableSchema = {
      ...base,
      ...(ddl ? { ddl } : {}),
    };

    this.schemaCache.set(table, tableSchema);
    this.schemaCache.set(cacheKey, tableSchema);
    if (resolved.schema === "public") {
      this.schemaCache.set(resolved.name, tableSchema);
    }
    return tableSchema;
  }

  async mutateRow(mutation: RowMutation): Promise<RowMutationResult> {
    const schema = await this.getTableSchema(mutation.table);
    // Quote the catalog's schema and table separately. Joining them with a dot
    // and splitting again would break a name that itself contains a dot, and
    // quoting the whole `schema.table` string looks up a different relation.
    const qualified = quotedQualifiedTable(schema.table);
    const built = buildMutation(mutation, schema, {
      quoteIdentifier: doubleQuoteIdentifier,
      quoteTable: () => qualified,
      parameterPlaceholder: dollarPlaceholder,
    });
    // No RETURNING: the command tag's `count` is already the number of rows
    // inserted, updated, or deleted, and RETURNING would require SELECT.
    const result = await this.sql.unsafe<Record<string, unknown>[]>(built.sql, built.params);
    return { affectedRows: normalizeCount((result as { count?: unknown }).count) };
  }

  async selectRows(request: SelectRowsRequest): Promise<SelectRowsResult> {
    const { columns, table } = await this.getTableSchema(request.table);
    // Quote the catalog's schema and name separately. Joining them and splitting
    // on `.` would treat a dot inside the name as a schema separator, and would
    // pick the wrong relation when the same name exists in another schema.
    const qualified = quotedQualifiedTable(table);
    const built = buildSelect(request, columns, {
      quoteIdentifier: doubleQuoteIdentifier,
      quoteTable: () => qualified,
      parameterPlaceholder: dollarPlaceholder,
    });

    // Count query placeholders restart at $1; re-number by rebuilding with the
    // same options is already correct because countSql only has the WHERE
    // placeholders and buildSelect embeds them with indices starting at 0.
    // However countSql currently reuses the main query's WHERE text which was
    // numbered as $1..$n before LIMIT/OFFSET — that is exactly what we want
    // for the count params array. No renumbering needed.

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

  private async getViewDefinition(schema: string, name: string): Promise<string | null> {
    try {
      const rows = await this.sql.unsafe<Record<string, unknown>[]>(
        `SELECT pg_catalog.pg_get_viewdef(c.oid, true) AS def
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'v'`,
        [schema, name],
      );
      const def = asString([...rows][0]?.def);
      if (!def) return null;
      return `CREATE VIEW ${doubleQuoteIdentifier(schema)}.${doubleQuoteIdentifier(name)} AS\n${def}`;
    } catch {
      return null;
    }
  }

  /**
   * Resolves a bare name or a schema-qualified ref ({@link parseTableRef}).
   * Bare names prefer `current_schema()`, then any non-system schema.
   * A quoted `.` stays inside the identifier, so it is not a schema separator.
   */
  private async resolveTable(table: string): Promise<{ schema: string; name: string; type: "table" | "view" }> {
    const parsed = parseTableRef(table);

    if (parsed.schema) {
      const rows = await this.sql.unsafe<Record<string, unknown>[]>(
        `SELECT table_schema, table_name, table_type
           FROM information_schema.tables
          WHERE table_schema = $1 AND table_name = $2
            AND table_type IN ('BASE TABLE', 'VIEW')
          LIMIT 1`,
        [parsed.schema, parsed.name],
      );
      const row = [...rows][0];
      if (!row) {
        throw new Error(`Table "${table}" was not found in the current database`);
      }
      return {
        schema: asString(row.table_schema) ?? parsed.schema,
        name: asString(row.table_name) ?? parsed.name,
        type: asString(row.table_type) === "VIEW" ? "view" : "table",
      };
    }

    // Prefer the session's current_schema (usually public), then first match.
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT table_schema, table_name, table_type
         FROM information_schema.tables
        WHERE table_name = $1
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
          AND table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY CASE WHEN table_schema = current_schema() THEN 0 ELSE 1 END, table_schema
        LIMIT 1`,
      [parsed.name],
    );
    const row = [...rows][0];
    if (!row) {
      throw new Error(`Table "${table}" was not found in the current database`);
    }
    return {
      schema: asString(row.table_schema) ?? "public",
      name: asString(row.table_name) ?? parsed.name,
      type: asString(row.table_type) === "VIEW" ? "view" : "table",
    };
  }
}

/** Builds a readable CREATE TABLE approximation — Postgres has no SHOW CREATE TABLE. */
function synthesizeCreateTable(schema: TableSchema): string {
  const qualified = schema.table.schema
    ? `${doubleQuoteIdentifier(schema.table.schema)}.${doubleQuoteIdentifier(schema.table.name)}`
    : doubleQuoteIdentifier(schema.table.name);

  const lines = schema.columns.map(column => {
    const parts = [`  ${doubleQuoteIdentifier(column.name)} ${column.dataType}`];
    if (!column.nullable) parts.push("NOT NULL");
    if (column.defaultValue !== null) parts.push(`DEFAULT ${column.defaultValue}`);
    return parts.join(" ");
  });

  if (schema.primaryKey.length > 0) {
    lines.push(`  PRIMARY KEY (${schema.primaryKey.map(doubleQuoteIdentifier).join(", ")})`);
  }

  return `CREATE TABLE ${qualified} (\n${lines.join(",\n")}\n)`;
}

/** Reads a driver-returned catalog value as a string, tolerating Buffers. */
function asString(value: unknown): string | null {
  const normalized = normalizeCellValue(value);
  return normalized === null ? null : String(normalized);
}
