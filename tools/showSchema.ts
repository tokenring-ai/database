import {Registry} from "@token-ring/registry";
import {z} from "zod";
import DatabaseResource from "../DatabaseResource.js";
import DatabaseService from "../DatabaseService.js";

export const name = "database/showSchema";

interface ShowSchemaParams {
  databaseName?: string;
}

export async function execute(
  {databaseName}: ShowSchemaParams,
  registry: Registry
): Promise<Record<string, any> | string> {
  const databaseService = registry.requireFirstServiceByType(DatabaseService);
  if (!databaseName) {
    throw new Error(`[${name}] databaseName is required`);
  }

  const databaseResource = databaseService.getResourceByName(databaseName);
  return databaseResource.showSchema();
}

export const description =
  "Shows the 'CREATE TABLE' statements (or equivalent) for all tables in the specified database.";

export const inputSchema = z.object({
  databaseName: z
    .string()
    .describe("The name of the database for which to show the schema."),
});