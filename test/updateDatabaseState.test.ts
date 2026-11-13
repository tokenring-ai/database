import { describe, expect, it } from "bun:test";
import { AgentManager } from "@tokenring-ai/agent";
import type Agent from "@tokenring-ai/agent/Agent";
import type TokenRingApp from "@tokenring-ai/app/TokenRingApp";
import DatabaseService from "../DatabaseService.ts";
import databaseRPC from "../rpc/database.ts";
import { DatabaseState } from "../state/DatabaseState.ts";
import type { DataSource, TableSchema } from "../types.ts";

const usersSchema: TableSchema = {
  table: { name: "users", schema: "public", type: "table" },
  columns: [{ name: "id", dataType: "int", nullable: false, isPrimaryKey: true, defaultValue: null }],
  primaryKey: ["id"],
};

function setup() {
  const state = new DatabaseState({});
  const agent = {
    getState: () => state,
    mutateState: (_slice: unknown, update: (state: DatabaseState) => void) => {
      update(state);
    },
  };
  const service = new DatabaseService();
  service.datasources.set("main", {
    getTableSchema: async () => usersSchema,
    async [Symbol.asyncDispose]() {},
  } as unknown as DataSource);

  const app = {
    requireService(token: unknown) {
      if (token === AgentManager) return { getAgent: () => agent as unknown as Agent };
      if (token === DatabaseService) return service;
      throw new Error(`unexpected service ${String(token)}`);
    },
  } as unknown as TokenRingApp;

  const execute = (
    databaseRPC as unknown as {
      methods: { updateDatabaseState: { execute: (args: Record<string, unknown>, app: TokenRingApp) => Promise<Record<string, unknown>> } };
    }
  ).methods.updateDatabaseState.execute;

  return { state, call: (args: Record<string, unknown>) => execute(args, app) };
}

describe("updateDatabaseState", () => {
  it("clears activeTable when table is omitted and the datasource is unchanged", async () => {
    const { state, call } = setup();

    await call({ agentId: "agent-1", datasource: "main", table: "public.users", selectedRows: [{ id: 1 }] });
    expect(state.activeDatasource).toBe("main");
    expect(state.activeTable).toBe("public.users");
    expect(state.activeTableSchema?.table.name).toBe("users");
    expect(state.selectedRows).toEqual([{ id: 1 }]);

    const cleared = await call({ agentId: "agent-1", datasource: "main", selectedRows: [] });
    expect(state.activeDatasource).toBe("main");
    expect(state.activeTable).toBeUndefined();
    expect(state.activeTableSchema).toBeUndefined();
    expect(state.selectedRows).toEqual([]);
    expect(cleared).toMatchObject({ status: "success", activeDatasource: "main", activeTable: null, activeTableSchema: null, selectedRowCount: 0 });
  });
});
