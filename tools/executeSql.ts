import { Registry } from "@token-ring/registry";
import { z } from "zod";
import DatabaseResource from "../DatabaseResource.js";

// Export the tool name in the required format
export const name = "database/executeSql";

interface ExecuteParams {
  databaseName?: string;
  sqlQuery?: string;
  queryParams?: Record<string, unknown>;
}

export async function execute(
  { databaseName, sqlQuery, queryParams }: ExecuteParams,
  registry: Registry
): Promise<string|object> {
  const resource = registry.resources.getFirstResourceByType(DatabaseResource);
  if (!resource) {
    throw new Error(`[${name}] Configuration error: DatabaseResource not found`);
  }
  if (!sqlQuery) {
    throw new Error(`[${name}] sqlQuery is required`);
  }

  try {
    const executionParams: Record<string, unknown> = {
      databaseName,
      ...(queryParams && typeof queryParams === "object" ? queryParams : {}),
    };
    return await resource.executeSql(sqlQuery, executionParams);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`[${name}] Failed to execute SQL query via resource: ${error.message}`);
    }
    throw new Error(`[${name}] Failed to execute SQL query via resource: ${String(error)}`);
  }
}

export const description =
  "Executes an arbitrary SQL query on a database using the DatabaseResource. WARNING: Use with extreme caution as this can modify or delete data.";

export const parameters = z.object({
  databaseName: z
    .string()
    .optional()
    .describe(
      "Optional: The name of the database to target. May also be specified in the SQL query."
    ),
  sqlQuery: z.string().describe("The SQL query to execute."),
  queryParams: z
    .object({})
    .passthrough()
    .optional()
    .describe(
      "Optional: Parameters for the SQL query, for prepared statements or specific connection needs."
    ),
});
