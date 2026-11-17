import { describe, expect, it, mock } from "bun:test";
import type Agent from "@tokenring-ai/agent/Agent";
import ChatService from "@tokenring-ai/chat/ChatService";
import { permissionSlug } from "@tokenring-ai/chat/permissions/permissionIds";
import DatabaseService from "../DatabaseService.ts";
import { MAX_ROW_LIMIT } from "../schema.ts";
import executeSql from "../tools/executeSql.ts";

function agentWith(rows: Record<string, unknown>[]): Agent {
  const service = {
    getDataSource: () => ({ executeSql: async () => ({ rows, fields: Object.keys(rows[0] ?? {}) }) }),
    getDataSourceConfig: () => ({ url: "sqlite://:memory:", allowWrites: false }),
    getDatasourceNames: () => ["main"],
  };
  return { requireService: (type: unknown) => (type === DatabaseService ? service : undefined) } as unknown as Agent;
}

describe("database_executeSql", () => {
  it("returns at most MAX_ROW_LIMIT rows to the agent and says the rest were left out", async () => {
    const rows = Array.from({ length: MAX_ROW_LIMIT + 250 }, (_, id) => ({ id }));
    const output = await executeSql.execute({ datasource: "main", sqlQuery: "SELECT * FROM events" }, agentWith(rows));
    const result = JSON.parse(output.result as string) as { rows: unknown[]; truncated?: string };

    expect(result.rows).toHaveLength(MAX_ROW_LIMIT);
    expect(result.truncated).toContain(`${MAX_ROW_LIMIT} of ${MAX_ROW_LIMIT + 250}`);
  });

  it("returns a small result whole", async () => {
    const output = await executeSql.execute({ datasource: "main", sqlQuery: "SELECT 1 AS one" }, agentWith([{ one: 1 }]));
    expect(JSON.parse(output.result as string)).toEqual({ rows: [{ one: 1 }], fields: ["one"] });
  });

  describe("write approval", () => {
    function writer({ allowWrites, approve }: { allowWrites: boolean; approve: boolean }) {
      const checkToolApproval = mock(async (_options: Record<string, unknown>) => approve);
      const executeSqlFn = mock(async (_sql: string, _options?: { readOnly?: boolean }) => ({ rows: [], fields: [] }));
      const service = {
        getDataSource: () => ({ executeSql: executeSqlFn }),
        getDataSourceConfig: () => ({ url: "sqlite://:memory:", allowWrites }),
        getDatasourceNames: () => ["My DB.prod"],
      };
      const agent = {
        requireService: (type: unknown) => (type === DatabaseService ? service : type === ChatService ? { checkToolApproval } : undefined),
      } as unknown as Agent;
      return { agent, checkToolApproval, executeSqlFn };
    }
    const write = { datasource: "My DB.prod", sqlQuery: "DELETE FROM events" };

    it("asks at level 8 with a datasource permission id, defaulting to No", async () => {
      const { agent, checkToolApproval, executeSqlFn } = writer({ allowWrites: true, approve: true });
      await executeSql.execute(write, agent);
      const options = checkToolApproval.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(options.safetyLevel).toBe(8);
      expect(options.default).toBe(false);
      expect(options.toolName).toBe("database_executeSql");
      expect(options.message).toContain("DELETE FROM events");
      expect(options.permission).toMatchObject({ id: `database.${permissionSlug("My DB.prod")}.write` });
      expect(executeSqlFn).toHaveBeenCalledTimes(1);
    });

    it("runs nothing when the write is not approved", async () => {
      const { agent, executeSqlFn } = writer({ allowWrites: true, approve: false });
      await expect(executeSql.execute(write, agent)).rejects.toThrow(/did not approve/);
      expect(executeSqlFn).not.toHaveBeenCalled();
    });

    it("refuses writes on a read-only datasource without asking", async () => {
      const { agent, checkToolApproval, executeSqlFn } = writer({ allowWrites: false, approve: true });
      const output = await executeSql.execute(write, agent);
      expect(output.failed).toBe(true);
      expect(checkToolApproval).not.toHaveBeenCalled();
      expect(executeSqlFn).not.toHaveBeenCalled();
    });

    it("never asks for a read", async () => {
      const { agent, checkToolApproval } = writer({ allowWrites: true, approve: false });
      await executeSql.execute({ datasource: "My DB.prod", sqlQuery: "SELECT 1" }, agent);
      expect(checkToolApproval).not.toHaveBeenCalled();
    });
  });
});
