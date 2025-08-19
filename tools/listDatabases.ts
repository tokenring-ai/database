import {Registry} from "@token-ring/registry";
import {z} from "zod";
import DatabaseResource from "../DatabaseResource.js";

export const name = "database/listDatabases";

export async function execute(
  {},
  registry: Registry
): Promise<string[]> {
  const resource = registry.resources.getFirstResourceByType(DatabaseResource);
  if (!resource) {
    throw new Error(`[${name}] Configuration error: DatabaseResource not found`);
  }


  return await resource.listDatabases();
}

export const description =
  "Lists all databases accessible by the configured database connection, using the DatabaseResource.";
export const inputSchema = z.object({});