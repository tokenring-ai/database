import {Registry} from "@token-ring/registry";
import {z} from "zod";
import DatabaseResource from "../DatabaseResource.js";
import DatabaseService from "../DatabaseService.js";

export const name = "database/listDatabases";

export async function execute(
  {},
  registry: Registry
): Promise<string> {
  const databaseService = registry.requireFirstServiceByType(DatabaseService);

  return `Available databases: ${Array.from(databaseService.getActiveResourceNames()).join(", ")}`;
}

export const description = "Lists all databases accessible by the configured database connections.";
export const inputSchema = z.object({});