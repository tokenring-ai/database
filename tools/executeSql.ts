import Agent from "@tokenring-ai/agent/Agent";
import {z} from "zod";
import DatabaseService from "../DatabaseService.js";

// Export the tool name in the required format
export const name = "database/executeSql";

interface ExecuteParams {
  databaseName?: string;
  sqlQuery?: string;
}

export async function execute(
  {databaseName, sqlQuery}: ExecuteParams,
  agent: Agent
): Promise<string | object> {
  const databaseService = agent.requireFirstServiceByType(DatabaseService);
  if (!databaseName) {
    throw new Error(`[${name}] databaseName is required`);
  }
  if (!sqlQuery) {
    throw new Error(`[${name}] sqlQuery is required`);
  }


  const databaseResource = databaseService.getResourceByName(databaseName);

  if (!sqlQuery.trim().startsWith("SELECT")) {
    if (!databaseResource.allowWrites) {
      throw new Error("Database does not allow write access.");
    }
  }
  return databaseResource.executeSql(sqlQuery);
}

export const description =
  "Executes an arbitrary SQL query on a database using the DatabaseResource. WARNING: Use with extreme caution as this can modify or delete data.";

export const inputSchema = z.object({
  databaseName: z
    .string()
    .optional()
    .describe(
      "Optional: The name of the database to target. May also be specified in the SQL query."
    ),
  sqlQuery: z.string().describe("The SQL query to execute."),
});
