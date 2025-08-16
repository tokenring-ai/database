import { Registry } from "@token-ring/registry";
import { z } from "zod";
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

  try {
    return await resource.listDatabases();
  } catch (error: any) {
    throw new Error(`[${name}] Failed to list databases via resource: ${error.message}`);
  }
}

export const description =
  "Lists all databases accessible by the configured database connection, using the DatabaseResource.";
export const parameters = z.object({});