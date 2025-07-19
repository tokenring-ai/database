import DatabaseResource from '../DatabaseResource.js';
import {z} from 'zod';

export async function execute({ databaseName }, registry) {
  const resource = registry.requireFirstServiceByType(DatabaseResource);

  if (!databaseName) {
    return { error: "databaseName is required" };
  }

  try {
   return await resource.showSchema(databaseName);
  } catch (error) {
    console.error('Error showing schema via resource:', error);
    return { error: `Failed to show schema via resource: ${error.message}` };
  }
}

export const description = "Shows the 'CREATE TABLE' statements (or equivalent) for all tables in the specified database, using the DatabaseResource.";

export const parameters = z.object({
  databaseName: z.string().describe("The name of the database for which to show the schema.")
});
