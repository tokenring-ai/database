import {z} from "zod";
import DatabaseResource from "../DatabaseResource.js";
import {Registry} from "@token-ring/registry";

export async function execute({}, registry: Registry): Promise<string[] | { error: string }> {
  const resource = registry.resources.getFirstResourceByType(DatabaseResource);
  if (!resource) {
      return { error: "Configuration error: DatabaseResource not found" };
  }

  try {
    return await resource.listDatabases();
  } catch (error: any) {
    console.error("Error listing databases via resource:", error);
    return { error: `Failed to list databases via resource: ${error.message}` };
  }
}

export const description =
  "Lists all databases accessible by the configured database connection, using the DatabaseResource.";
export const parameters = z.object({});