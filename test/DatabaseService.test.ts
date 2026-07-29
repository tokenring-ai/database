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
  });

  it("lowercases the scheme", () => {
    expect(schemeOf("MySQL://host/db")).toBe("mysql");
  });

  it("throws on something that isn't a URL", () => {
    expect(() => schemeOf("not a url")).toThrow();
  });
});

describe("DatabaseService.reconfigure", () => {
  it("instantiates a datasource from a mysql:// url", () => {
    const { service, created } = serviceWithStubFactory();
    service.reconfigure({ main: { url: "mysql://user:pw@host:3306/db", allowWrites: false } });

    expect(service.getDatasourceNames()).toEqual(["main"]);
    expect(created).toHaveLength(1);
  });

  it("reports a helpful error for an unregistered scheme", () => {
    const { service } = serviceWithStubFactory();
    expect(() => service.reconfigure({ main: { url: "postgres://host/db", allowWrites: false } })).toThrow(
      /No provider registered for database scheme postgres/,
    );
  });

  it("keeps the existing connection when config is unchanged", () => {
    const { service, created } = serviceWithStubFactory();
    const config = { main: { url: "mysql://host/db", allowWrites: false } };

    service.reconfigure(config);
    service.reconfigure({ main: { url: "mysql://host/db", allowWrites: false } });

    // Without this.config being assigned, the second pass would rebuild.
    expect(created).toHaveLength(1);
    expect(created[0]!.disposed).toBe(false);
  });

  it("replaces and disposes the old connection when the url changes", () => {
    const { service, created } = serviceWithStubFactory();
    service.reconfigure({ main: { url: "mysql://host/db", allowWrites: false } });
    service.reconfigure({ main: { url: "mysql://other/db", allowWrites: false } });

    expect(created).toHaveLength(2);
    expect(created[0]!.disposed).toBe(true);
    expect(created[1]!.disposed).toBe(false);
  });

  it("leaves the working connection in place when the replacement can't be built", () => {
    const { service, created } = serviceWithStubFactory();
    service.reconfigure({ main: { url: "mysql://host/db", allowWrites: false } });

    expect(() => service.reconfigure({ main: { url: "postgres://host/db", allowWrites: false } })).toThrow();

    // Build-before-dispose: the original must still be usable, not a disposed husk.
    expect(created[0]!.disposed).toBe(false);
    expect(service.getDataSource("main")).toBe(created[0] as unknown as DataSource);
  });

  it("disposes a datasource that was removed from config", () => {
    const { service, created } = serviceWithStubFactory();
    service.reconfigure({ main: { url: "mysql://host/db", allowWrites: false } });
    service.reconfigure({});

    expect(created[0]!.disposed).toBe(true);
    expect(service.getDatasourceNames()).toEqual([]);
  });

  it("exposes allowWrites for the write guard", () => {
    const { service } = serviceWithStubFactory();
    service.reconfigure({
      ro: { url: "mysql://host/ro", allowWrites: false },
      rw: { url: "mysql://host/rw", allowWrites: true },
    });

    expect(service.getDataSourceConfig("ro")?.allowWrites).toBe(false);
    expect(service.getDataSourceConfig("rw")?.allowWrites).toBe(true);
    expect(service.getDataSourceConfig("missing")).toBeUndefined();
  });
});
