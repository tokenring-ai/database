import {z} from 'zod';
import DatabaseResource from '../DatabaseResource.js';

export async function execute(args, registry) {
  const resource = registry.requireFirstServiceByType(DatabaseResource);

  try {
   return await resource.listDatabases();
  } catch (error) {
    console.error('Error listing databases via resource:', error);
    return { error: `Failed to list databases via resource: ${error.message}` };
  }
}

export const description = "Lists all databases accessible by the configured database connection, using the DatabaseResource.";
export const parameters = z.object({});
