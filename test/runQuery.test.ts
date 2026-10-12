import { afterEach, describe, expect, it } from "bun:test";
import type TokenRingApp from "@tokenring-ai/app/TokenRingApp";
import DatabaseService from "../DatabaseService.ts";
import SQLiteDatabaseProvider from "../providers/SQLiteDatabaseProvider.ts";
import databaseRPC from "../rpc/database.ts";
import { MAX_ROW_LIMIT } from "../schema.ts";
import type { DataSource } from "../types.ts";
import runQuery, { clampRowLimit } from "../util/runQuery.ts";

const providers: SQLiteDatabaseProvider[] = [];

afterEach(async () => {
  while (providers.length > 0) await providers.pop()![Symbol.asyncDispose]();
});

async function seeded(rowCount = 3): Promise<SQLiteDatabaseProvider> {
  const provider = new SQLiteDatabaseProvider({ url: "sqlite://:memory:", allowWrites: true });
  providers.push(provider);
  await provider.executeSql("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)");
  for (let id = 1; id <= rowCount; id++) {
    await provider.executeSql(`INSERT INTO users (id, email) VALUES (${id}, 'u${id}@example.com')`);
  }
  return provider;
}

describe("runQuery", () => {
  it("runs a read with fields, row count and elapsed time", async () => {
    const provider = await seeded();
    let tick = 0;
    const result = await runQuery(provider, "SELECT id, email FROM users ORDER BY id", {
      datasourceName: "main",
      allowWrites: false,
      now: () => (tick += 7),
    });
    expect(result).toMatchObject({ status: "success", fields: ["id", "email"], rowCount: 3, truncated: false, readOnly: true, elapsedMs: 7 });
    if (result.status === "success") expect(result.rows[0]).toEqual({ id: 1, email: "u1@example.com" });
  });

  it("truncates to the row limit and reports the full count", async () => {
    const provider = await seeded(5);
    const result = await runQuery(provider, "SELECT * FROM users", { datasourceName: "main", allowWrites: false, maxRows: 2 });
    expect(result).toMatchObject({ status: "success", rowCount: 5, truncated: true });
    if (result.status === "success") expect(result.rows).toHaveLength(2);
  });

  it("refuses a write on a read-only datasource without running it", async () => {
    const provider = await seeded();
    const result = await runQuery(provider, "DELETE FROM users", { datasourceName: "main", allowWrites: false, confirmWrite: true });
    expect(result.status).toBe("writeRefused");
    expect((await provider.executeSql("SELECT COUNT(*) AS n FROM users")).rows[0]).toEqual({ n: 3 });
  });

  it("asks for confirmation before a write on a writable datasource", async () => {
    const provider = await seeded();
    const unconfirmed = await runQuery(provider, "DELETE FROM users WHERE id = 1", { datasourceName: "main", allowWrites: true });
    expect(unconfirmed).toEqual({ status: "confirmationRequired", message: "This statement can modify data. Run it anyway?" });
    expect((await provider.executeSql("SELECT COUNT(*) AS n FROM users")).rows[0]).toEqual({ n: 3 });

    const confirmed = await runQuery(provider, "DELETE FROM users WHERE id = 1", { datasourceName: "main", allowWrites: true, confirmWrite: true });
    expect(confirmed).toMatchObject({ status: "success", readOnly: false });
    expect((await provider.executeSql("SELECT COUNT(*) AS n FROM users")).rows[0]).toEqual({ n: 2 });
  });

  it("treats a read followed by a write as a write", async () => {
    const provider = await seeded();
    const result = await runQuery(provider, "SELECT 1; DROP TABLE users", { datasourceName: "main", allowWrites: true });
    expect(result.status).toBe("confirmationRequired");
  });

  it("reports SQL errors instead of throwing", async () => {
    const provider = await seeded();
    const result = await runQuery(provider, "SELECT * FROM missing_table", { datasourceName: "main", allowWrites: false });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error).toContain("missing_table");
  });

  it("clamps the row limit to MAX_ROW_LIMIT", () => {
    expect(clampRowLimit(undefined)).toBe(MAX_ROW_LIMIT);
    expect(clampRowLimit(0)).toBe(MAX_ROW_LIMIT);
    expect(clampRowLimit(MAX_ROW_LIMIT * 10)).toBe(MAX_ROW_LIMIT);
    expect(clampRowLimit(25)).toBe(25);
  });
});

describe("database RPC executeSql / showSchema", () => {
  async function setup(allowWrites: boolean) {
    const provider = await seeded();
    const service = new DatabaseService();
    service.registerFactory("sqlite", () => provider as unknown as DataSource);
    await service.reconfigure({ main: { url: "sqlite://:memory:", allowWrites } });
    const app = { requireService: () => service } as unknown as TokenRingApp;
    type Method = (args: Record<string, unknown>, app: TokenRingApp) => unknown;
    const methods = (databaseRPC as unknown as { methods: Record<string, { execute: Method }> }).methods;
    return (name: string, args: Record<string, unknown>) => methods[name]!.execute(args, app);
  }

  it("follows the datasource's allowWrites flag", async () => {
    const readOnly = await setup(false);
    expect(((await readOnly("executeSql", { datasource: "main", sql: "UPDATE users SET email = 'x'", confirmWrite: true })) as { status: string }).status).toBe(
      "writeRefused",
    );
    const read = (await readOnly("executeSql", { datasource: "main", sql: "SELECT COUNT(*) AS n FROM users" })) as { status: string; rows: unknown[] };
    expect(read.status).toBe("success");
    expect(read.rows).toEqual([{ n: 3 }]);
  });

  it("returns the CREATE statements from showSchema", async () => {
    const call = await setup(false);
    const { schema } = (await call("showSchema", { datasource: "main" })) as { schema: Record<string, string> };
    expect(Object.keys(schema)).toEqual(["users"]);
    expect(schema.users).toContain("CREATE TABLE users");
  });
});

describe("database RPC mutateRow", () => {
  async function setup(allowWrites: boolean) {
    const provider = await seeded();
    const service = new DatabaseService();
    service.registerFactory("sqlite", () => provider as unknown as DataSource);
    await service.reconfigure({ main: { url: "sqlite://:memory:", allowWrites } });
    const app = { requireService: () => service } as unknown as TokenRingApp;
    type Method = (args: Record<string, unknown>, app: TokenRingApp) => unknown;
    const methods = (databaseRPC as unknown as { methods: Record<string, { execute: Method }> }).methods;
    const call = (name: string, args: Record<string, unknown>) => methods[name]!.execute(args, app);
    const emails = async () => (await provider.executeSql("SELECT email FROM users ORDER BY id")).rows.map(row => row.email);
    return { call, emails };
  }

  it("inserts, updates and deletes single rows with bound values", async () => {
    const { call, emails } = await setup(true);

    expect(await call("mutateRow", { datasource: "main", table: "users", kind: "insert", values: { id: 4, email: "o'brien@example.com" } })).toEqual({
      status: "success",
      affectedRows: 1,
    });
    expect(
      await call("mutateRow", { datasource: "main", table: "users", kind: "update", key: { id: 1 }, values: { email: "x'; DROP TABLE users; --" } }),
    ).toEqual({
      status: "success",
      affectedRows: 1,
    });
    expect(await call("mutateRow", { datasource: "main", table: "users", kind: "delete", key: { id: 2 } })).toEqual({ status: "success", affectedRows: 1 });
    expect(await emails()).toEqual(["x'; DROP TABLE users; --", "u3@example.com", "o'brien@example.com"]);

    // A key that matches nothing changes nothing.
    expect(await call("mutateRow", { datasource: "main", table: "users", kind: "delete", key: { id: 99 } })).toEqual({ status: "success", affectedRows: 0 });
  });

  it("refuses edits on a read-only datasource", async () => {
    const { call, emails } = await setup(false);
    const result = (await call("mutateRow", { datasource: "main", table: "users", kind: "delete", key: { id: 1 } })) as { status: string };
    expect(result.status).toBe("writeRefused");
    expect(await emails()).toHaveLength(3);
  });

  it("reports invalid requests as errors", async () => {
    const { call } = await setup(true);
    const result = (await call("mutateRow", { datasource: "main", table: "users", kind: "delete", key: { email: "u1@example.com" } })) as {
      status: string;
      error: string;
    };
    expect(result.status).toBe("error");
    expect(result.error).toContain("primary key");
  });
});
