import { AgentManager } from "@tokenring-ai/agent";
import type Agent from "@tokenring-ai/agent/Agent";
import type TokenRingApp from "@tokenring-ai/app/TokenRingApp";
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import formatError from "@tokenring-ai/utility/error/formatError";
import DatabaseService, { schemeOf } from "../DatabaseService.ts";
import { DatabaseState } from "../state/DatabaseState.ts";
import type { RowMutation } from "../types.ts";
import runQuery from "../util/runQuery.ts";
import DatabaseRpcSchema from "./schema.ts";

/** The projection every agent-scoped method returns, read back from state. */
function projectState(agent: Agent, service: DatabaseService) {
  const state = agent.getState(DatabaseState);
  return {
    status: "success" as const,
    activeDatasource: state.activeDatasource ?? null,
    activeTable: state.activeTable ?? null,
    activeTableSchema: state.activeTableSchema ?? null,
    selectedRowCount: state.selectedRows.length,
    availableDatasources: service.getDatasourceNames(),
  };
}

export default createRPCEndpoint(DatabaseRpcSchema, {
  getDatabaseConfiguration(_args, app: TokenRingApp) {
    const service = app.requireService(DatabaseService);
    const ready = service.getDatasourceNames().map(name => {
      const config = service.getDataSourceConfig(name);
      return {
        name,
        // Derived rather than stored: the scheme is safe to show, the URL isn't.
        scheme: config ? schemeOf(config.url) : "unknown",
        allowWrites: config?.allowWrites ?? false,
        status: "ready" as const,
      };
    });
    const missing = Object.entries(service.getMissingSecretDatasources())
      .filter(([name]) => !ready.some(entry => entry.name === name))
      .map(([name, { allowWrites }]) => ({ name, scheme: "unknown", allowWrites, status: "missingSecret" as const }));
    return {
      datasources: [...ready, ...missing],
      agentTypes: service.getAgentTypes(),
    };
  },

  async testConnection({ datasource: name, url }, app: TokenRingApp) {
    const service = app.requireService(DatabaseService);
    if (url !== undefined) {
      try {
        const { tableCount } = await service.testUrl(url);
        return { ok: true, tableCount };
      } catch (err) {
        return { ok: false, error: formatError(err) };
      }
    }
    if (name in service.getMissingSecretDatasources()) {
      return { ok: false, error: `Datasource "${name}" has no connection string set` };
    }
    const datasource = service.getDataSource(name);
    if (!datasource) {
      return { ok: false, error: `No datasource named "${name}" is configured` };
    }
    try {
      const tables = await datasource.listTables();
      return { ok: true, tableCount: tables.length };
    } catch (err) {
      return { ok: false, error: formatError(err) };
    }
  },

  async listTables({ datasource }, app: TokenRingApp) {
    const tables = await app.requireService(DatabaseService).requireDataSource(datasource).listTables();
    return { tables };
  },

  async getTableSchema({ datasource, table }, app: TokenRingApp) {
    const schema = await app.requireService(DatabaseService).requireDataSource(datasource).getTableSchema(table);
    return { schema };
  },

  async selectRows({ datasource, table, columns, filters, orderBy, limit, offset }, app: TokenRingApp) {
    return await app
      .requireService(DatabaseService)
      .requireDataSource(datasource)
      .selectRows({
        table,
        ...(columns ? { columns } : {}),
        ...(filters ? { filters } : {}),
        ...(orderBy ? { orderBy } : {}),
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
  },

  async executeSql({ datasource: name, sql, confirmWrite, maxRows }, app: TokenRingApp) {
    const service = app.requireService(DatabaseService);
    const datasource = service.requireDataSource(name);
    return await runQuery(datasource, sql, {
      datasourceName: name,
      // A datasource missing from the config map is treated as read-only.
      allowWrites: service.getDataSourceConfig(name)?.allowWrites ?? false,
      confirmWrite,
      maxRows,
    });
  },

  async showSchema({ datasource }, app: TokenRingApp) {
    const schema = await app.requireService(DatabaseService).requireDataSource(datasource).showSchema();
    return { schema };
  },

  async mutateRow(input, app: TokenRingApp) {
    const service = app.requireService(DatabaseService);
    const datasource = service.requireDataSource(input.datasource);
    if (!service.getDataSourceConfig(input.datasource)?.allowWrites) {
      return {
        status: "writeRefused" as const,
        message: `The datasource '${input.datasource}' is read-only (allowWrites: false). Enable writes for this datasource to edit rows.`,
      };
    }
    if (!datasource.mutateRow) {
      return { status: "unsupported" as const, message: `The datasource '${input.datasource}' does not support row editing.` };
    }
    const mutation: RowMutation =
      input.kind === "insert"
        ? { kind: "insert", table: input.table, values: input.values }
        : input.kind === "update"
          ? { kind: "update", table: input.table, key: input.key, values: input.values }
          : { kind: "delete", table: input.table, key: input.key };
    try {
      const { affectedRows } = await datasource.mutateRow(mutation);
      return { status: "success" as const, affectedRows };
    } catch (err) {
      return { status: "error" as const, error: formatError(err) };
    }
  },

  getDatabaseState({ agentId }, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(agentId);
    if (!agent) {
      return { status: "agentNotFound" };
    }
    return projectState(agent, app.requireService(DatabaseService));
  },

  async updateDatabaseState({ agentId, datasource, table, selectedRows }, app: TokenRingApp) {
    const agent = app.requireService(AgentManager).getAgent(agentId);
    if (!agent) {
      return { status: "agentNotFound" };
    }
    const service = app.requireService(DatabaseService);

    if (datasource) {
      service.setActiveDatasource(datasource, agent);
    }
    if (table) {
      const target = datasource ?? agent.getState(DatabaseState).activeDatasource;
      if (target) {
        await service.selectTable(target, table, agent);
      }
    }
    if (selectedRows) {
      service.setSelectedRows(selectedRows, agent);
    }

    return projectState(agent, service);
  },
});
