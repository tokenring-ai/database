import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { z } from "zod";
import { resolveDatasource } from "../util/resolveDatasource.ts";

const name = "database_showSchema";
const displayName = "Database/showSchema";

async function execute({ datasource: dataSourceName }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const resolved = resolveDatasource(dataSourceName, "showSchema", agent);
  if (resolved.failure) return resolved.failure;

  const schema = await resolved.datasource.showSchema();
  return {
    message: `**Database** Viewed schema for ${dataSourceName}`,
    result: JSON.stringify(schema),
  };
}

const description = "Shows the 'CREATE TABLE' statements (or equivalent) for all tables in the specified database.";

const inputSchema = z.object({
  datasource: z.string().describe("The name of the datasource to target."),
});

const requiredContextHandlers = ["datasources"];

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
  requiredContextHandlers,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
