import type { TokenRingPlugin } from "@tokenring-ai/app";
import { ChatService } from "@tokenring-ai/chat";
import { AgentLifecycleService } from "@tokenring-ai/lifecycle";
import { RpcService } from "@tokenring-ai/rpc";
import { resolveSecret } from "@tokenring-ai/secrets";
import classFactory from "@tokenring-ai/utility/class/factory";
import { z } from "zod";
import config from "./config/index.ts";
import contextHandlers from "./contextHandlers.ts";
import DatabaseService from "./DatabaseService.ts";
import addSelectedRows from "./hooks/addSelectedRows.ts";
import packageJSON from "./package.json" with { type: "json" };
import MySQLDatabaseProvider from "./providers/MySQLDatabaseProvider.ts";
import PostgreSQLDatabaseProvider from "./providers/PostgreSQLDatabaseProvider.ts";
import SQLiteDatabaseProvider from "./providers/SQLiteDatabaseProvider.ts";
import databaseRPC from "./rpc/database.ts";
import { DatabaseServiceConfigSchema, type ResolvedDatabaseServiceConfig } from "./schema.ts";
import tools from "./tools.ts";

const packageConfigSchema = z.object({
  database: DatabaseServiceConfigSchema,
});

export default {
  name: packageJSON.name,
  displayName: "Database Layer",
  version: packageJSON.version,
  description: packageJSON.description,
  config,
  install(app) {
    const databaseService = app.addService(DatabaseService, new DatabaseService());

    databaseService.registerFactory("mysql", classFactory(MySQLDatabaseProvider));
    databaseService.registerFactory("mariadb", classFactory(MySQLDatabaseProvider));
    databaseService.registerFactory("postgres", classFactory(PostgreSQLDatabaseProvider));
    databaseService.registerFactory("postgresql", classFactory(PostgreSQLDatabaseProvider));
    databaseService.registerFactory("sqlite", classFactory(SQLiteDatabaseProvider));
    databaseService.registerFactory("file", classFactory(SQLiteDatabaseProvider));

    app.waitForService(ChatService, chatService => {
      chatService.addTools(tools);
      chatService.registerContextHandlers(contextHandlers);
    });

    app.waitForService(AgentLifecycleService, lifecycleService => lifecycleService.addHooks(addSelectedRows));

    app.waitForService(RpcService, rpcService => {
      rpcService.registerEndpoint(databaseRPC);
    });
  },
  async reconfigure(app, config) {
    // Connection strings are secret references; resolve them here so the
    // service only ever deals in plain URLs.
    const resolved: ResolvedDatabaseServiceConfig = {};
    for (const [name, datasource] of Object.entries(config.database.datasources)) {
      const url = resolveSecret(app, datasource.url);
      if (!url) continue; // Unset secret — skip rather than fail the whole app's boot.
      resolved[name] = { url, allowWrites: datasource.allowWrites };
    }
    await app.requireService(DatabaseService).reconfigure(resolved, config.database.agentTypes);
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
