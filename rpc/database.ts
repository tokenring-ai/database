import { AgentManager } from "@tokenring-ai/agent";
import type Agent from "@tokenring-ai/agent/Agent";
import type TokenRingApp from "@tokenring-ai/app/TokenRingApp";
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import formatError from "@tokenring-ai/utility/error/formatError";
import DatabaseService, { schemeOf } from "../DatabaseService.ts";
import { DatabaseState } from "../state/DatabaseState.ts";
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
  getDatasources(_args, app: TokenRingApp) {
    const service = app.requireService(DatabaseService);
    return {
      datasources: service.getDatasourceNames().map(name => {
        const config = service.getDataSourceConfig(name);
        return {
          name,
          // Derived rather than stored: the scheme is safe to show, the URL isn't.
          scheme: config ? schemeOf(config.url) : "unknown",
          allowWrites: config?.allowWrites ?? false,
        };
      }),
    };
  },

  async testConnection({ datasource: name }, app: TokenRingApp) {
    const service = app.requireService(DatabaseService);
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
