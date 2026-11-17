import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import SQLiteDatabaseProvider, { sqliteFilenameFromUrl } from "../providers/SQLiteDatabaseProvider.ts";

describe("sqliteFilenameFromUrl", () => {
  it("maps memory aliases to :memory:", () => {
    expect(sqliteFilenameFromUrl(":memory:")).toBe(":memory:");
    expect(sqliteFilenameFromUrl("sqlite::memory:")).toBe(":memory:");
    expect(sqliteFilenameFromUrl("sqlite://:memory:")).toBe(":memory:");
    expect(sqliteFilenameFromUrl("sqlite:///:memory:")).toBe(":memory:");
  });

  it("extracts absolute paths from sqlite and file URLs", () => {
    expect(sqliteFilenameFromUrl("sqlite:///tmp/data.db")).toBe("/tmp/data.db");
    expect(sqliteFilenameFromUrl("file:///tmp/data.db")).toBe("/tmp/data.db");
  });

  it("keeps relative sqlite://./ paths", () => {
    expect(sqliteFilenameFromUrl("sqlite://./local.db")).toBe("./local.db");
  });
});

describe("SQLiteDatabaseProvider", () => {
  const providers: SQLiteDatabaseProvider[] = [];

  afterEach(async () => {
    while (providers.length > 0) {
      const provider = providers.pop()!;
      await provider[Symbol.asyncDispose]();
    }
  });

  function open(url = "sqlite://:memory:"): SQLiteDatabaseProvider {
    const provider = new SQLiteDatabaseProvider({ url, allowWrites: true });
    providers.push(provider);
    return provider;
  }

  async function seed(provider: SQLiteDatabaseProvider): Promise<void> {
    await provider.executeSql(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL,
        age INTEGER,
        bio TEXT
      )
    `);
    await provider.executeSql(`CREATE VIEW adult_users AS SELECT id, email FROM users WHERE age >= 18`);
    await provider.executeSql(`INSERT INTO users (id, email, age, bio) VALUES (1, 'a@example.com', 30, 'hello')`);
    await provider.executeSql(`INSERT INTO users (id, email, age, bio) VALUES (2, 'b@example.com', 12, NULL)`);
    await provider.executeSql(`INSERT INTO users (id, email, age, bio) VALUES (3, 'c@example.com', 25, 'world')`);
  }

  it("lists tables and views", async () => {
    const provider = open();
    await seed(provider);

    const tables = await provider.listTables();
    expect(tables.map(t => t.name).sort()).toEqual(["adult_users", "users"]);
    expect(tables.find(t => t.name === "adult_users")?.type).toBe("view");
    expect(tables.find(t => t.name === "users")?.type).toBe("table");
  });

  it("describes a table including primary key and nullability", async () => {
    const provider = open();
    await seed(provider);

    const schema = await provider.getTableSchema("users");
    expect(schema.table.name).toBe("users");
    expect(schema.primaryKey).toEqual(["id"]);
    expect(schema.columns.map(c => c.name)).toEqual(["id", "email", "age", "bio"]);
    expect(schema.columns.find(c => c.name === "email")?.nullable).toBe(false);
    expect(schema.columns.find(c => c.name === "bio")?.nullable).toBe(true);
    expect(schema.ddl).toInclude("CREATE TABLE users");
  });

  it("throws for an unknown table", async () => {
    const provider = open();
    await seed(provider);
    expect(provider.getTableSchema("nope")).rejects.toThrow(/not found/);
  });

  it("selects rows with filters, sort and paging", async () => {
    const provider = open();
    await seed(provider);

    const page = await provider.selectRows({
      table: "users",
      columns: ["id", "email"],
      filters: [{ column: "age", op: "gte", value: 18 }],
      orderBy: [{ column: "id", direction: "asc" }],
      limit: 1,
      offset: 0,
    });

    expect(page.fields).toEqual(["id", "email"]);
    expect(page.rows).toEqual([{ id: 1, email: "a@example.com" }]);
    expect(page.totalCount).toBe(2);
    expect(page.hasMore).toBe(true);

    const next = await provider.selectRows({
      table: "users",
      columns: ["id", "email"],
      filters: [{ column: "age", op: "gte", value: 18 }],
      orderBy: [{ column: "id", direction: "asc" }],
      limit: 1,
      offset: 1,
    });
    expect(next.rows).toEqual([{ id: 3, email: "c@example.com" }]);
    expect(next.hasMore).toBe(false);
  });

  it("returns CREATE statements via showSchema", async () => {
    const provider = open();
    await seed(provider);

    const schema = await provider.showSchema();
    expect(schema.users).toInclude("CREATE TABLE");
    expect(schema.adult_users).toInclude("CREATE VIEW");
  });

  it("opens a file-backed database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sqlite-provider-"));
    const dbPath = join(dir, "data.db");
    try {
      const provider = open(`sqlite://${dbPath}`);
      await provider.executeSql("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
      await provider.executeSql("INSERT INTO t (name) VALUES ('x')");
      const result = await provider.selectRows({ table: "t", limit: 10, offset: 0 });
      expect(result.rows).toEqual([{ id: 1, name: "x" }]);
      expect(result.totalCount).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps integers beyond 2^53 exact when they are written and filtered on", async () => {
    const provider = open();
    await provider.executeSql("CREATE TABLE events (id INTEGER PRIMARY KEY, counter INTEGER)");
    await provider.executeSql("INSERT INTO events (id, counter) VALUES (9007199254740992, 1), (9007199254740993, 2)");

    // As the browser now sends them: exact digit strings.
    await provider.mutateRow({ kind: "update", table: "events", key: { id: "9007199254740993" }, values: { counter: "12345678901234567" } });

    const { rows } = await provider.selectRows({ table: "events", filters: [{ column: "id", op: "eq", value: "9007199254740993" }], limit: 10, offset: 0 });
    expect(rows).toEqual([{ id: "9007199254740993", counter: "12345678901234567" }]);
  });

  it("sees a column added with ALTER TABLE without a restart", async () => {
    const provider = open();
    await seed(provider);
    expect((await provider.getTableSchema("users")).columns.map(c => c.name)).not.toContain("nickname");

    await provider.executeSql("ALTER TABLE users ADD COLUMN nickname TEXT");
    expect((await provider.getTableSchema("users")).columns.map(c => c.name)).toContain("nickname");
  });
});
