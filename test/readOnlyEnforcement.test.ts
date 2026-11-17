import { afterEach, describe, expect, it } from "bun:test";
import type Agent from "@tokenring-ai/agent/Agent";
import ChatService from "@tokenring-ai/chat/ChatService";
import DatabaseService from "../DatabaseService.ts";
import SQLiteDatabaseProvider from "../providers/SQLiteDatabaseProvider.ts";
import executeSql from "../tools/executeSql.ts";
import type { DataSource } from "../types.ts";
import { ReadOnlyViolationError } from "../util/readOnlyViolation.ts";
import runQuery from "../util/runQuery.ts";

const providers: SQLiteDatabaseProvider[] = [];
afterEach(async () => {
  while (providers.length > 0) await providers.pop()![Symbol.asyncDispose]();
});

describe("SQLite read-only mode", () => {
  it("refuses a write the database is asked to run as a read, then allows writes again", async () => {
    const provider = new SQLiteDatabaseProvider({ url: "sqlite://:memory:", allowWrites: true });
    providers.push(provider);
    await provider.executeSql("CREATE TABLE t (x INTEGER)");

    expect((await provider.executeSql("SELECT 1 AS one", { readOnly: true })).rows).toEqual([{ one: 1 }]);
    await expect(provider.executeSql("INSERT INTO t VALUES (1)", { readOnly: true })).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect((await provider.executeSql("SELECT count(*) AS n FROM t")).rows).toEqual([{ n: 0 }]);

    await provider.executeSql("INSERT INTO t VALUES (2)");
    expect((await provider.executeSql("SELECT count(*) AS n FROM t")).rows).toEqual([{ n: 1 }]);
  });
});

/**
 * A datasource whose "read" writes when run for real, like Postgres `SELECT nextval('s')`: refused
 * in read-only mode, runs otherwise.
 */
function sneakyDatasource() {
  const runs: { readOnly: boolean }[] = [];
  const datasource = {
    executeSql: async (_sql: string, { readOnly = false }: { readOnly?: boolean } = {}) => {
      runs.push({ readOnly });
      if (readOnly) throw new ReadOnlyViolationError(new Error("cannot execute nextval() in a read-only transaction"));
      return { rows: [{ nextval: 1 }], fields: ["nextval"] };
    },
  } as unknown as DataSource;
  return { datasource, runs };
}

describe("a statement that looks like a read but writes", () => {
  const sql = "SELECT nextval('ids')";

  it("is refused by the Query view on a read-only datasource, and asks for confirmation on a writable one", async () => {
    const readOnly = sneakyDatasource();
    expect((await runQuery(readOnly.datasource, sql, { datasourceName: "main", allowWrites: false })).status).toBe("writeRefused");
    expect(readOnly.runs).toEqual([{ readOnly: true }]);

    const writable = sneakyDatasource();
    expect((await runQuery(writable.datasource, sql, { datasourceName: "main", allowWrites: true })).status).toBe("confirmationRequired");
    // Once confirmed, it runs as the write it is.
    expect((await runQuery(writable.datasource, sql, { datasourceName: "main", allowWrites: true, confirmWrite: true })).status).toBe("success");
    expect(writable.runs).toEqual([{ readOnly: true }, { readOnly: false }]);
  });

  function agentFor(datasource: DataSource, allowWrites: boolean, approve: boolean) {
    const asked: string[] = [];
    const service = {
      getDataSource: () => datasource,
      getDataSourceConfig: () => ({ url: "x", allowWrites }),
      getDatasourceNames: () => ["main"],
    };
    const agent = {
      requireService: (type: unknown) =>
        type === DatabaseService
          ? service
          : type === ChatService
            ? {
                checkToolApproval: async ({ message }: { message: string }) => {
                  asked.push(message);
                  return approve;
                },
              }
            : undefined,
    } as unknown as Agent;
    return { agent, asked };
  }

  it("is refused for an agent on a read-only datasource", async () => {
    const { datasource, runs } = sneakyDatasource();
    const { agent, asked } = agentFor(datasource, false, true);
    const output = await executeSql.execute({ datasource: "main", sqlQuery: sql }, agent);
    expect(output.failed).toBe(true);
    expect(asked).toEqual([]);
    expect(runs).toEqual([{ readOnly: true }]);
  });

  it("needs the user's approval, like any write, on a writable datasource", async () => {
    const { datasource, runs } = sneakyDatasource();
    const { agent, asked } = agentFor(datasource, true, true);
    await executeSql.execute({ datasource: "main", sqlQuery: sql }, agent);
    expect(asked).toHaveLength(1);
    expect(runs).toEqual([{ readOnly: true }, { readOnly: false }]);
  });
});
