import { describe, expect, it } from "bun:test";
import DatabaseService, { schemeOf } from "../DatabaseService.ts";
import type { DataSource, DataSourceOptions } from "../types.ts";

/** Minimal DataSource that records whether it was disposed. */
function stubDataSource(options: DataSourceOptions) {
  const stub = {
    options,
    disposed: false,
    executeSql: async () => ({ rows: [], fields: [] }),
    showSchema: async () => ({}),
    listTables: async () => [],
    getTableSchema: async () => {
      throw new Error("not implemented");
    },
    selectRows: async () => ({ rows: [], fields: [], totalCount: 0, hasMore: false }),
    async [Symbol.asyncDispose]() {
      stub.disposed = true;
    },
  };
  return stub;
}

function serviceWithStubFactory() {
  const created: ReturnType<typeof stubDataSource>[] = [];
  const service = new DatabaseService();
  service.registerFactory("mysql", options => {
    const stub = stubDataSource(options);
    created.push(stub);
    return stub as unknown as DataSource;
  });
  return { service, created };
}

describe("schemeOf", () => {
  it("strips the trailing colon URL.protocol leaves behind", () => {
    // The bug this guards: factories register "mysql", URL.protocol yields "mysql:".
    expect(schemeOf("mysql://user:pw@host:3306/db")).toBe("mysql");
    expect(schemeOf("mariadb://host/db")).toBe("mariadb");
    expect(schemeOf("postgres://host/db")).toBe("postgres");
    expect(schemeOf("postgresql://host/db")).toBe("postgresql");
    expect(schemeOf("sqlite:///tmp/data.db")).toBe("sqlite");
    expect(schemeOf("file:///tmp/data.db")).toBe("file");
  });

  it("lowercases the scheme", () => {
    expect(schemeOf("MySQL://host/db")).toBe("mysql");
  });

  it("handles sqlite memory forms the WHATWG URL parser rejects", () => {
    expect(schemeOf("sqlite://:memory:")).toBe("sqlite");
    expect(schemeOf(":memory:")).toBe("sqlite");
  });

  it("throws on something that isn't a URL", () => {
    expect(() => schemeOf("not a url")).toThrow();
  });
});

describe("DatabaseService.reconfigure", () => {
  it("instantiates a datasource from a mysql:// url", async () => {
    const { service, created } = serviceWithStubFactory();
    await service.reconfigure({ main: { url: "mysql://user:pw@host:3306/db", allowWrites: false } });

    expect(service.getDatasourceNames()).toEqual(["main"]);
    expect(created).toHaveLength(1);
  });

  it("reports a helpful error for an unregistered scheme", async () => {
    const { service } = serviceWithStubFactory();
    await expect(service.reconfigure({ main: { url: "postgres://host/db", allowWrites: false } })).rejects.toThrow(
      /No provider registered for database scheme postgres/,
    );
  });

  it("keeps the existing connection when config is unchanged", async () => {
    const { service, created } = serviceWithStubFactory();
    const config = { main: { url: "mysql://host/db", allowWrites: false } };

    await service.reconfigure(config);
    await service.reconfigure({ main: { url: "mysql://host/db", allowWrites: false } });

    // Without this.config being assigned, the second pass would rebuild.
    expect(created).toHaveLength(1);
    expect(created[0]!.disposed).toBe(false);
  });

  it("replaces and disposes the old connection when the url changes", async () => {
    const { service, created } = serviceWithStubFactory();
    await service.reconfigure({ main: { url: "mysql://host/db", allowWrites: false } });
    await service.reconfigure({ main: { url: "mysql://other/db", allowWrites: false } });

    expect(created).toHaveLength(2);
    expect(created[0]!.disposed).toBe(true);
    expect(created[1]!.disposed).toBe(false);
  });

  it("leaves the working connection in place when the replacement can't be built", async () => {
    const { service, created } = serviceWithStubFactory();
    await service.reconfigure({ main: { url: "mysql://host/db", allowWrites: false } });

    await expect(service.reconfigure({ main: { url: "postgres://host/db", allowWrites: false } })).rejects.toThrow();

    // Build-before-dispose: the original must still be usable, not a disposed husk.
    expect(created[0]!.disposed).toBe(false);
    expect(service.getDataSource("main")).toBe(created[0] as unknown as DataSource);
  });

  it("still applies the other datasources' settings when one has an unknown scheme", async () => {
    const { service } = serviceWithStubFactory();
    await service.reconfigure({ prod: { url: "mysql://host/prod", allowWrites: true } });

    // prod is locked down in the same save that adds an entry nothing can open.
    await expect(
      service.reconfigure({ bad: { url: "mssql://host/db", allowWrites: true }, prod: { url: "mysql://host/prod", allowWrites: false } }),
    ).rejects.toThrow(/mssql.*"bad".*other datasources were applied/);

    expect(service.getDataSourceConfig("prod")?.allowWrites).toBe(false);
    expect(service.getDatasourceNames()).toEqual(["prod"]);
  });

  it("disposes a datasource that was removed from config", async () => {
    const { service, created } = serviceWithStubFactory();
    await service.reconfigure({ main: { url: "mysql://host/db", allowWrites: false } });
    await service.reconfigure({});

    expect(created[0]!.disposed).toBe(true);
    expect(service.getDatasourceNames()).toEqual([]);
  });

  it("awaits async disposal before reconfigure resolves", async () => {
    let disposeFinished = false;
    const service = new DatabaseService();
    service.registerFactory("mysql", options => {
      const stub = stubDataSource(options);
      stub[Symbol.asyncDispose] = async () => {
        await Promise.resolve();
        stub.disposed = true;
        disposeFinished = true;
      };
      return stub as unknown as DataSource;
    });

    await service.reconfigure({ main: { url: "mysql://host/db", allowWrites: false } });
    await service.reconfigure({});

    expect(disposeFinished).toBe(true);
  });

  it("exposes allowWrites for the write guard", async () => {
    const { service } = serviceWithStubFactory();
    await service.reconfigure({
      ro: { url: "mysql://host/ro", allowWrites: false },
      rw: { url: "mysql://host/rw", allowWrites: true },
    });

    expect(service.getDataSourceConfig("ro")?.allowWrites).toBe(false);
    expect(service.getDataSourceConfig("rw")?.allowWrites).toBe(true);
    expect(service.getDataSourceConfig("missing")).toBeUndefined();
  });
});

describe("DatabaseService.stop", () => {
  it("disposes every datasource and clears the registry", async () => {
    const { service, created } = serviceWithStubFactory();
    await service.reconfigure({
      a: { url: "mysql://host/a", allowWrites: false },
      b: { url: "mysql://host/b", allowWrites: true },
    });

    await service.stop();

    expect(created.map(stub => stub.disposed)).toEqual([true, true]);
    expect(service.getDatasourceNames()).toEqual([]);
    expect(service.getDataSourceConfig("a")).toBeUndefined();
  });

  it("still disposes the others when one dispose fails, then reports the failure", async () => {
    const { service, created } = serviceWithStubFactory();
    await service.reconfigure({
      a: { url: "mysql://host/a", allowWrites: false },
      b: { url: "mysql://host/b", allowWrites: false },
    });
    created[0]![Symbol.asyncDispose] = async () => {
      throw new Error("pool close failed");
    };

    await expect(service.stop()).rejects.toThrow(/Failed to dispose 1 datasource/);
    expect(created[1]!.disposed).toBe(true);
  });
});
