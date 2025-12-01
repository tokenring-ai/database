import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingToolDefinition} from "@tokenring-ai/chat/types";
import {z} from "zod";
import DatabaseService from "../DatabaseService.js";

const name = "database/showSchema";

interface ShowSchemaParams {
  databaseName?: string;
}

async function execute(
  {databaseName}: z.infer<typeof inputSchema>,
  agent: Agent
): Promise<Record<string, any> | string> {
  const databaseService = agent.requireServiceByType(DatabaseService);
  if (!databaseName) {
    throw new Error(`[${name}] databaseName is required`);
  }

  const databaseResource = databaseService.getDatabaseByName(databaseName);
  if (!databaseResource) {
    throw new Error(`[${name}] Database ${databaseName} not found`);
  }
  return databaseResource.showSchema();
}

const description =
  "Shows the 'CREATE TABLE' statements (or equivalent) for all tables in the specified database.";

const inputSchema = z.object({
  databaseName: z
    .string()
    .describe("The name of the database for which to show the schema."),
});

const requiredContextHandlers = ["available-databases"];

export default {
  name, description, inputSchema, execute, requiredContextHandlers
} as TokenRingToolDefinition<typeof inputSchema>;