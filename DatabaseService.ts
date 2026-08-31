import type Agent from "@tokenring-ai/agent/Agent";
import type { AgentCreationContext } from "@tokenring-ai/agent/types";
import type { TokenRingService } from "@tokenring-ai/app/types";
import deepEqual from "@tokenring-ai/utility/object/deepEqual";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import { DatabaseAgentConfigSchema, type ResolvedDatabaseConfiguration, type ResolvedDatabaseServiceConfig } from "./schema.ts";
import { DatabaseState } from "./state/DatabaseState.ts";
import type { DatabaseProviderFactory, DataSource, Row, TableSchema } from "./types.ts";

/**
 * Extracts the factory key from a connection string: `mysql://…` -> `mysql`.
 * `URL.protocol` keeps the trailing colon, which providers do not register with.
 *
 * Also accepts forms the WHATWG URL parser rejects but Bun's SQL client allows,
 * notably `sqlite://:memory:` and a bare `:memory:` (treated as sqlite).
 */
export function schemeOf(url: string): string {
  const trimmed = url.trim();
  if (trimmed === ":memory:") return "sqlite";

  try {
    return new URL(trimmed).protocol.replace(/:$/, "").toLowerCase();
  } catch {
    // e.g. sqlite://:memory: — still has a scheme prefix we can read.
    const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (match?.[1]) return match[1].toLowerCase();
    throw new Error("Invalid connection string: could not parse a URL scheme from it");
  }
}

export default class DatabaseService implements TokenRingService {
  readonly name = "DatabaseService";
  description = "Database service";
  datasources = new KeyedRegistry<DataSource>();
  // A mapping from the URL scheme to the provider, ie mysql:// -> factories[mysql] => (options) => DataSource;
  factories = new KeyedRegistry<DatabaseProviderFactory>();

  registerFactory = this.factories.set;

  requireDataSource = this.datasources.require;
  getDataSource = this.datasources.get;
  getDatasourceNames = this.datasources.keysArray;

  config: ResolvedDatabaseServiceConfig = {};
  private agentTypes: string[] = ["database"];

  /** Configuration for one datasource, for callers that need `allowWrites`. */
  getDataSourceConfig(name: string): ResolvedDatabaseConfiguration | undefined {
    return this.config[name];
  }

  /** Agent types configured for database work (from DatabaseServiceConfigSchema.agentTypes). */
  getAgentTypes(): string[] {
    return [...this.agentTypes];
  }

  private buildDataSource(config: ResolvedDatabaseConfiguration): DataSource {
    const scheme = schemeOf(config.url);
    const factory = this.factories.get(scheme);
    if (!factory) {
      throw new Error(`No provider registered for database scheme ${scheme}. Registered schemes: ${this.factories.keysArray().join(", ") || "(none)"}`);
    }
    return factory(config);
  }

  async reconfigure(config: ResolvedDatabaseServiceConfig, agentTypes?: readonly string[]): Promise<void> {
    if (agentTypes) {
      this.agentTypes = [...agentTypes];
    }

    await this.datasources.reconcileAgainstAsync(config, {
      creating: (_name, datasourceConfig) => this.buildDataSource(datasourceConfig),
      deleting: async (_name, datasource) => {
        await datasource[Symbol.asyncDispose]();
      },
      updating: async (name, datasource, datasourceConfig) => {
        if (deepEqual(this.config[name], datasourceConfig)) return datasource;

        // Build first: a throw here then leaves the existing connection in place
        // rather than parking an already-disposed one in the registry.
        const replacement = this.buildDataSource(datasourceConfig);
        await datasource[Symbol.asyncDispose]();
        return replacement;
      },
    });

    this.config = config;
  }

  // ─── Agent state ────────────────────────────────────────────────────────────

  attach(agent: Agent, creationContext: AgentCreationContext): void {
    const agentConfig = agent.getAgentConfigSlice("database", DatabaseAgentConfigSchema);
    const initialState = agent.initializeState(DatabaseState, agentConfig);
    creationContext.items.push(`Datasource: ${initialState.activeDatasource ?? "(none)"}`);
  }

  setActiveDatasource(name: string, agent: Agent): void {
    agent.mutateState(DatabaseState, state => {
      if (state.activeDatasource === name) return;
      state.activeDatasource = name;
      // A table selected on the previous datasource means nothing here.
      state.activeTable = undefined;
      state.activeTableSchema = undefined;
      state.selectedRows = [];
    });
  }

  /** Selects a table and caches its schema on the agent so the hook can attach it. */
  async selectTable(datasourceName: string, table: string, agent: Agent): Promise<TableSchema> {
    const datasource = this.requireDataSource(datasourceName);
    const schema = await datasource.getTableSchema(table);
    agent.mutateState(DatabaseState, state => {
      state.activeDatasource = datasourceName;
      if (state.activeTable !== table) state.selectedRows = [];
      state.activeTable = table;
      state.activeTableSchema = schema;
    });
    return schema;
  }

  setSelectedRows(rows: Row[], agent: Agent): void {
    agent.mutateState(DatabaseState, state => {
      state.selectedRows = rows;
    });
  }
}
