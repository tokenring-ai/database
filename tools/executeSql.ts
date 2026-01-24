import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingToolDefinition} from "@tokenring-ai/chat/schema";
import {z} from "zod";
import DatabaseService from "../DatabaseService.js";

// Export the tool name in the required format
const name = "database_executeSql";
const displayName = "Database/executeSql";

async function execute(
  {databaseName, sqlQuery}: z.infer<typeof inputSchema>,
  agent: Agent
): Promise<string | object> {
  const databaseService = agent.requireServiceByType(DatabaseService);
  if (!databaseName) {
    throw new Error(`[${name}] databaseName is required`);
  }
  if (!sqlQuery) {
    throw new Error(`[${name}] sqlQuery is required`);
  }


  const databaseResource = databaseService.getDatabaseByName(databaseName);
  if (!databaseResource) {
    throw new Error(`[${name}] Database ${databaseName} not found`);
  }

  if (!sqlQuery.trim().startsWith("SELECT")) {
    const approved = await agent.askForConfirmation({
      message: `Execute SQL write operation on database '${databaseName}'?\n\nQuery: ${sqlQuery}`,
    });

    if (!approved) {
      throw new Error("User did not approve the SQL query that was provided.");
    }
  }
  return databaseResource.executeSql(sqlQuery);
}

const description =
  "Executes an arbitrary SQL query on a database using the DatabaseResource. WARNING: Use with extreme caution as this can modify or delete data.";

const inputSchema = z.object({
  databaseName: z
    .string()
    .optional()
    .describe(
      "Optional: The name of the database to target. May also be specified in the SQL query."
    ),
  sqlQuery: z.string().describe("The SQL query to execute."),
});

const requiredContextHandlers = ["available-databases"];

export default {
  name, displayName, description, inputSchema, execute, requiredContextHandlers
} satisfies TokenRingToolDefinition<typeof inputSchema>;