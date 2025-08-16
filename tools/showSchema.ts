import {Registry} from "@token-ring/registry";
import {z} from "zod";
import DatabaseResource from "../DatabaseResource.js";

interface ShowSchemaParams {
  databaseName?: string;
}

export async function execute(
  {databaseName}: ShowSchemaParams,
  registry: Registry
): Promise<Record<string, any> | string | { error: string }> {
  const resource = registry.resources.getFirstResourceByType(DatabaseResource);
  if (!resource) {
    return {error: "Configuration error: DatabaseResource not found"};
  }
  if (!databaseName) {
    return {error: "databaseName is required"};
  }

  try {
    return await resource.showSchema(databaseName);
  } catch (error: any) {
    console.error("Error showing schema via resource:", error);
    return {error: `Failed to show schema via resource: ${error.message}`};
  }
}

export const description =
  "Shows the 'CREATE TABLE' statements (or equivalent) for all tables in the specified database, using the DatabaseResource.";

export const parameters = z.object({
  databaseName: z
    .string()
    .describe("The name of the database for which to show the schema."),
});