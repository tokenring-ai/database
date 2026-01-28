import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingToolDefinition, type TokenRingToolJSONResult} from "@tokenring-ai/chat/schema";
import {z} from "zod";
import DatabaseService from "../DatabaseService.js";

const name = "database_showSchema";
const displayName = "Database/showSchema";
async function execute(
  {databaseName}: z.output<typeof inputSchema>,
  agent: Agent
) : Promise<TokenRingToolJSONResult<any>> {
  const databaseService = agent.requireServiceByType(DatabaseService);

  const databaseResource = databaseService.getDatabaseByName(databaseName);
  if (!databaseResource) {
    throw new Error(`[${name}] Database ${databaseName} not found`);
  }
  return { type: 'json', data: await databaseResource.showSchema() };
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
  name, displayName, description, inputSchema, execute, requiredContextHandlers
} satisfies TokenRingToolDefinition<typeof inputSchema>;