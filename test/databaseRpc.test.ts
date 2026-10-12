import { describe, expect, it } from "bun:test";
import type TokenRingApp from "@tokenring-ai/app/TokenRingApp";
import DatabaseService from "../DatabaseService.ts";
import databaseRPC from "../rpc/database.ts";
import type { DataSource, DataSourceOptions } from "../types.ts";

function stubDataSource(options: DataSourceOptions, tables: string[]) {
  const stub = {
    options,
    disposed: false,
    listTables: async () => {
      if (options.url.includes("bad")) throw new Error("connection refused");
      return tables.map(name => ({ name, type: "table" as const }));
    },
    async [Symbol.asyncDispose]() {
      stub.disposed = true;
    },
  };
  return stub;
}

function setup() {
  const created: ReturnType<typeof stubDataSource>[] = [];
  const service = new DatabaseService();
  service.registerFactory("mysql", options => {
    const stub = stubDataSource(options, ["users", "orders"]);
    created.push(stub);
    return stub as unknown as DataSource;
  });
  const app = { requireService: () => service } as unknown as TokenRingApp;
  type Method = (args: Record<string, unknown>, app: TokenRingApp) => unknown;
  const methods = (databaseRPC as unknown as { methods: Record<string, { execute: Method }> }).methods;
  const call = (name: string, args: Record<string, unknown>) => methods[name]!.execute(args, app);
  return { service, created, call };
}

describe("database RPC", () => {
  it("lists datasources with an unset secret instead of dropping them", async () => {
    const { service, call } = setup();
    await service.reconfigure({ main: { url: "mysql://host/db", allowWrites: true } }, undefined, { pending: { allowWrites: false } });

    const config = (await call("getDatabaseConfiguration", {})) as { datasources: unknown[] };
    expect(config.datasources).toEqual([
      { name: "main", scheme: "mysql", allowWrites: true, status: "ready" },
      { name: "pending", scheme: "unknown", allowWrites: false, status: "missingSecret" },
    ]);
    expect(await call("testConnection", { datasource: "pending" })).toEqual({ ok: false, error: 'Datasource "pending" has no connection string set' });

    // Setting the secret later clears the flag.
    await service.reconfigure({ main: { url: "mysql://host/db", allowWrites: true } });
    expect(((await call("getDatabaseConfiguration", {})) as { datasources: unknown[] }).datasources).toHaveLength(1);
  });

  it("dry-runs a connection string without registering or keeping it", async () => {
    const { service, created, call } = setup();

    expect(await call("testConnection", { datasource: "new", url: "mysql://host/db" })).toEqual({ ok: true, tableCount: 2 });
    expect(service.getDatasourceNames()).toEqual([]);
    expect(created[0]!.disposed).toBe(true);

    const failed = (await call("testConnection", { datasource: "new", url: "mysql://bad/db" })) as { ok: boolean; error?: string };
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("connection refused");
    expect(created[1]!.disposed).toBe(true);
  });
});
