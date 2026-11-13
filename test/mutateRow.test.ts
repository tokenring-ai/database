import { describe, expect, it } from "bun:test";
import MySQLDatabaseProvider from "../providers/MySQLDatabaseProvider.ts";
import PostgreSQLDatabaseProvider from "../providers/PostgreSQLDatabaseProvider.ts";
import type { DataSource, RowMutation, TableRef, TableSchema } from "../types.ts";

// The jsdom preload replaces URL. Bun.SQL reads searchParams.toJSON(), which
// jsdom's URLSearchParams does not implement. Patch it so the providers can be
// constructed; the driver is replaced before any connection is used.
const searchParamsProto = Object.getPrototypeOf(new URL("mysql://127.0.0.1/db").searchParams) as { toJSON?: () => Record<string, string> };
if (typeof searchParamsProto.toJSON !== "function") {
  searchParamsProto.toJSON = function toJSON(this: URLSearchParams) {
    return Object.fromEntries(this.entries());
  };
}

const injected = "x'; DROP TABLE users; --";

interface DriverCall {
  sql: string;
  params: unknown;
}

type SqlHandle = {
  unsafe(sql: string, params?: unknown): Promise<unknown>;
  close(): Promise<void>;
};

function usersSchema(table: Partial<TableRef> = {}): TableSchema {
  return {
    table: { name: "users", type: "table", ...table },
    columns: [
      { name: "id", dataType: "int", nullable: false, isPrimaryKey: true, defaultValue: null },
      { name: "email", dataType: "varchar(255)", nullable: false, isPrimaryKey: false, defaultValue: null },
      { name: "bio", dataType: "text", nullable: true, isPrimaryKey: false, defaultValue: null },
    ],
    primaryKey: ["id"],
  };
}

/**
 * Seeds the schema cache and replaces the driver so mutateRow never opens a
 * connection. `tableKey` is the name the caller passes (the cache key).
 */
async function withDriver(
  provider: DataSource,
  tableKey: string,
  schema: TableSchema,
  resultFor: (call: DriverCall) => unknown,
  run: (calls: DriverCall[]) => Promise<void>,
): Promise<void> {
  const target = provider as unknown as { sql: SqlHandle; schemaCache: Map<string, TableSchema> };
  const real = target.sql;
  const calls: DriverCall[] = [];
  target.schemaCache.set(tableKey, schema);
  target.sql = {
    unsafe(sql: string, params?: unknown) {
      const call = { sql, params };
      calls.push(call);
      return Promise.resolve(resultFor(call));
    },
    close: () => Promise.resolve(),
  };
  try {
    await run(calls);
  } finally {
    target.sql = real;
    await real.close();
  }
}

function openMySQL(): MySQLDatabaseProvider {
  return new MySQLDatabaseProvider({ url: "mysql://127.0.0.1:1/none", allowWrites: true });
}

function openPostgres(): PostgreSQLDatabaseProvider {
  return new PostgreSQLDatabaseProvider({ url: "postgres://127.0.0.1:1/none", allowWrites: true });
}

describe("MySQLDatabaseProvider.mutateRow", () => {
  const schema = usersSchema();

  it("inserts, updates and deletes with backtick identifiers and bound ? params", async () => {
    const provider = openMySQL();
    await withDriver(
      provider,
      "users",
      schema,
      call => (call.sql.startsWith("DELETE") ? { count: 9, affectedRows: 0 } : { count: 0, affectedRows: 1 }),
      async calls => {
        expect(await provider.mutateRow({ kind: "insert", table: "users", values: { id: 4, email: "o'brien@example.com" } })).toEqual({
          affectedRows: 1,
        });
        expect(calls[0]).toEqual({
          sql: "INSERT INTO `users` (`id`, `email`) VALUES (?, ?)",
          params: [4, "o'brien@example.com"],
        });

        expect(await provider.mutateRow({ kind: "update", table: "users", key: { id: 7 }, values: { email: injected, bio: "hi" } })).toEqual({
          affectedRows: 1,
        });
        expect(calls[1]).toEqual({
          sql: "UPDATE `users` SET `email` = ?, `bio` = ? WHERE `id` = ?",
          params: [injected, "hi", 7],
        });
        expect(calls[1]!.sql).not.toContain("DROP");

        // count is the result-set size (9 here); the OK packet says nothing changed.
        expect(await provider.mutateRow({ kind: "delete", table: "users", key: { id: 99 } })).toEqual({ affectedRows: 0 });
        expect(calls[2]).toEqual({ sql: "DELETE FROM `users` WHERE `id` = ?", params: [99] });
      },
    );
  });

  it("falls back to count when the driver omits affectedRows", async () => {
    const provider = openMySQL();
    await withDriver(
      provider,
      "users",
      schema,
      () => ({ count: 1 }),
      async calls => {
        expect(await provider.mutateRow({ kind: "delete", table: "users", key: { id: 1 } })).toEqual({ affectedRows: 1 });
        expect(calls).toHaveLength(1);
      },
    );
  });

  it("rejects an unknown column or a non-primary-key before calling the driver", async () => {
    const provider = openMySQL();
    await withDriver(
      provider,
      "users",
      schema,
      () => ({ affectedRows: 1 }),
      async calls => {
        const badColumn: RowMutation = { kind: "insert", table: "users", values: { "email`; DROP TABLE users; --": "x" } };
        await expect(provider.mutateRow(badColumn)).rejects.toThrow(/Unknown column/);
        const badKey: RowMutation = { kind: "delete", table: "users", key: { email: "u1@example.com" } };
        await expect(provider.mutateRow(badKey)).rejects.toThrow(/primary key/);
        expect(calls).toHaveLength(0);
      },
    );
  });
});

describe("PostgreSQLDatabaseProvider.mutateRow", () => {
  const schema = usersSchema({ schema: "public" });

  it("inserts, updates and deletes with quoted schema.table and $n params", async () => {
    const provider = openPostgres();
    await withDriver(
      provider,
      "users",
      schema,
      call => (call.sql.startsWith("DELETE") ? { count: 0, affectedRows: 5 } : { count: 1, affectedRows: 99 }),
      async calls => {
        expect(await provider.mutateRow({ kind: "insert", table: "users", values: { id: 4, email: "o'brien@example.com" } })).toEqual({
          affectedRows: 1,
        });
        expect(calls[0]).toEqual({
          sql: 'INSERT INTO "public"."users" ("id", "email") VALUES ($1, $2)',
          params: [4, "o'brien@example.com"],
        });

        expect(await provider.mutateRow({ kind: "update", table: "users", key: { id: 7 }, values: { email: injected, bio: "hi" } })).toEqual({
          affectedRows: 1,
        });
        expect(calls[1]).toEqual({
          sql: 'UPDATE "public"."users" SET "email" = $1, "bio" = $2 WHERE "id" = $3',
          params: [injected, "hi", 7],
        });
        expect(calls[1]!.sql).not.toContain("DROP");
        expect(calls[1]!.sql).not.toContain("RETURNING");

        // Command-tag count, not a MySQL-style affectedRows field and not RETURNING rows.
        expect(await provider.mutateRow({ kind: "delete", table: "users", key: { id: 99 } })).toEqual({ affectedRows: 0 });
        expect(calls[2]).toEqual({ sql: 'DELETE FROM "public"."users" WHERE "id" = $1', params: [99] });
      },
    );
  });

  it("quotes a schema-qualified caller name from the catalog, not as one identifier", async () => {
    const provider = openPostgres();
    await withDriver(
      provider,
      "public.users",
      schema,
      () => ({ count: 1 }),
      async calls => {
        await provider.mutateRow({ kind: "delete", table: "public.users", key: { id: 1 } });
        expect(calls[0]).toEqual({ sql: 'DELETE FROM "public"."users" WHERE "id" = $1', params: [1] });
      },
    );
  });

  it("quotes a table name that itself contains a dot", async () => {
    const provider = openPostgres();
    await withDriver(
      provider,
      "odd.name",
      usersSchema({ schema: "app", name: "odd.name" }),
      () => ({ count: 1 }),
      async calls => {
        await provider.mutateRow({ kind: "delete", table: "odd.name", key: { id: 2 } });
        expect(calls[0]).toEqual({ sql: 'DELETE FROM "app"."odd.name" WHERE "id" = $1', params: [2] });
      },
    );
  });

  it("rejects an unknown column or a non-primary-key before calling the driver", async () => {
    const provider = openPostgres();
    await withDriver(
      provider,
      "users",
      schema,
      () => ({ count: 1 }),
      async calls => {
        const badColumn: RowMutation = { kind: "insert", table: "users", values: { "email`; DROP TABLE users; --": "x" } };
        await expect(provider.mutateRow(badColumn)).rejects.toThrow(/Unknown column/);
        const badKey: RowMutation = { kind: "delete", table: "users", key: { email: "u1@example.com" } };
        await expect(provider.mutateRow(badKey)).rejects.toThrow(/primary key/);
        expect(calls).toHaveLength(0);
      },
    );
  });

  it("qualifies SELECT with the catalog schema when the table name contains a dot", async () => {
    const provider = openPostgres();
    await withDriver(
      provider,
      'analytics."odd.name"',
      usersSchema({ schema: "analytics", name: "odd.name" }),
      () => [{ total: 0 }],
      async calls => {
        await provider.selectRows({ table: 'analytics."odd.name"', limit: 5, offset: 0 });
        expect(calls[0]!.sql).toContain('FROM "analytics"."odd.name"');
        expect(calls[1]!.sql).toContain('FROM "analytics"."odd.name"');
        expect(calls[0]!.sql).not.toContain('"analytics.odd.name"');
      },
    );
  });

  it("resolves a schema-qualified name outside current_schema, without splitting a quoted dot", async () => {
    const provider = openPostgres();
    await withDriver(
      provider,
      "unrelated",
      usersSchema(),
      call => {
        if (call.sql.includes("pg_attribute")) {
          return [
            {
              column_name: "id",
              data_type: "integer",
              is_nullable: false,
              column_default: null,
              column_comment: null,
              is_primary_key: true,
            },
          ];
        }
        if (call.sql.includes("information_schema.tables")) {
          const params = call.params as string[];
          const schemaName = call.sql.includes("current_schema") ? "public" : params[0];
          const name = call.sql.includes("current_schema") ? params[0] : params[1];
          return [{ table_schema: schemaName, table_name: name, table_type: "BASE TABLE" }];
        }
        return [];
      },
      async calls => {
        const qualified = await provider.getTableSchema("analytics.users");
        expect(calls[0]!.params).toEqual(["analytics", "users"]);
        expect(calls[0]!.sql).not.toContain("current_schema");
        expect(qualified.table).toMatchObject({ schema: "analytics", name: "users", type: "table" });

        const dotted = await provider.getTableSchema('analytics."odd.name"');
        expect(calls[2]!.params).toEqual(["analytics", "odd.name"]);
        expect(calls[2]!.sql).not.toContain("current_schema");
        expect(dotted.table).toMatchObject({ schema: "analytics", name: "odd.name" });

        const quotedBare = await provider.getTableSchema('"odd.name"');
        expect(calls[4]!.params).toEqual(["odd.name"]);
        expect(calls[4]!.sql).toContain("current_schema");
        expect(quotedBare.table).toMatchObject({ schema: "public", name: "odd.name" });
      },
    );
  });
});

describe("MySQLDatabaseProvider.executeSql", () => {
  it("reports the OK-packet affectedRows, not the result-set count of a write", async () => {
    const provider = openMySQL();
    await withDriver(
      provider,
      "users",
      usersSchema(),
      () => Object.assign([], { count: 0, affectedRows: 4 }),
      async () => {
        expect(await provider.executeSql("UPDATE users SET email = 'a'")).toMatchObject({ rows: [], affectedRows: 4 });
      },
    );
  });

  it("falls back to count when the driver omits affectedRows", async () => {
    const provider = openMySQL();
    await withDriver(
      provider,
      "users",
      usersSchema(),
      () => Object.assign([{ id: 1 }], { count: 1 }),
      async () => {
        expect(await provider.executeSql("SELECT id FROM users")).toMatchObject({ rows: [{ id: 1 }], affectedRows: 1 });
      },
    );
  });
});
