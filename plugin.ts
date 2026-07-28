import type { TokenRingPlugin } from "@tokenring-ai/app";
import { ChatService } from "@tokenring-ai/chat";
import { z } from "zod";
import contextHandlers from "./contextHandlers.ts";
import DatabaseService from "./DatabaseService.ts";
import packageJSON from "./package.json" with { type: "json" };
import { DatabaseServiceConfigSchema } from "./schema.ts";
import tools from "./tools.ts";

const packageConfigSchema = z.object({
  database: DatabaseServiceConfigSchema,
});

export default {
  name: packageJSON.name,
  displayName: "Database Layer",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app) {
    app.addServices(new DatabaseService());
    app.waitForService(ChatService, chatService => {
      chatService.addTools(...tools);
      chatService.registerContextHandlers(contextHandlers);
    });
  },
  reconfigure(app, config) {
    app.requireService(DatabaseService).reconfigure(config.database);
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
