import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { ToolCallError } from "@tokenring-ai/chat/util/tokenRingTool";
import markdownList from "@tokenring-ai/utility/string/markdownList";
import { z } from "zod";
import DatabaseService from "../DatabaseService.ts";

// Export the tool name in the required format
const name = "database_executeSql";
const displayName = "Database/executeSql";

async function execute({ datasource: datasourceName, sqlQuery }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const databaseService = agent.requireServiceByType(DatabaseService);

  const datasource = databaseService.getDataSource(datasourceName);
  if (!datasource) {
    return {
      failed: true,
      message: `**Database** Error while running showSchema: Incorrect datasource value`,
      result: `No datasource named ${datasourceName} found. Currently available datasources:
${markdownList(databaseService.getDatasourceNames())}
    `,
    };
  }

  if (!sqlQuery.trim().startsWith("SELECT")) {
    const approved = await agent.askForApproval({
      message: `Execute SQL write operation on datasource: '${datasourceName}'?\n\nQuery: ${sqlQuery}`,
    });

    if (!approved) {
      throw new ToolCallError(name, "User did not approve the SQL query that was provided.");
    }
  }
  const result = await datasource.executeSql(sqlQuery);
  return {
    message: `**Database** Executed SQL`,
    result: JSON.stringify(result),
  };
}

const description =
  "Executes an arbitrary SQL query on a database using the DatabaseResource. WARNING: Use with extreme caution as this can modify or delete data.";

const inputSchema = z.object({
  datasource: z.string().describe("The name of the datasource to target."),
  sqlQuery: z.string().describe("The SQL query to execute."),
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
