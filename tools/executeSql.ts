import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingToolDefinition, type TokenRingToolJSONResult} from "@tokenring-ai/chat/schema";
import {z} from "zod";
import DatabaseService from "../DatabaseService.js";

// Export the tool name in the required format
const name = "database_executeSql";
const displayName = "Database/executeSql";

async function execute(
  {databaseName, sqlQuery}: z.output<typeof inputSchema>,
  agent: Agent
) : Promise<TokenRingToolJSONResult<any>> {
  const databaseService = agent.requireServiceByType(DatabaseService);

  const databaseResource = databaseService.getDatabaseByName(databaseName || '');
  if (!databaseResource) {
    throw new Error(`[${name}] Database ${databaseName} not found`);
  }

  if (!sqlQuery.trim().startsWith("SELECT")) {
    const approved = await agent.askForApproval({
      message: `Execute SQL write operation on database '${databaseName}'?\n\nQuery: ${sqlQuery}`,
    });

    if (!approved) {
      throw new Error("User did not approve the SQL query that was provided.");
    }
  }
  const result = await databaseResource.executeSql(sqlQuery);
  return { type: 'json', data: result };
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