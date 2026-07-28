import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import markdownList from "@tokenring-ai/utility/string/markdownList";
import { z } from "zod";
import DatabaseService from "../DatabaseService.ts";

const name = "database_showSchema";
const displayName = "Database/showSchema";

async function execute({ datasource: dataSourceName }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const databaseService = agent.requireServiceByType(DatabaseService);

  const datasource = databaseService.getDataSource(dataSourceName);
  if (!datasource) {
    return {
      failed: true,
      message: `**Database** Error while running showSchema: Incorrect datasource value`,
      result: `No datasource named ${dataSourceName} found. Currently available datasources:
${markdownList(databaseService.getDatasourceNames())}
    `,
    };
  }

  const schema = await datasource.showSchema();
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
