import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { ToolCallError } from "@tokenring-ai/chat/util/tokenRingTool";
import { z } from "zod";
import isReadOnlyQuery from "../util/isReadOnlyQuery.ts";
import { resolveDatasource } from "../util/resolveDatasource.ts";

// Export the tool name in the required format
const name = "database_executeSql";
const displayName = "Database/executeSql";

async function execute({ datasource: datasourceName, sqlQuery }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const resolved = resolveDatasource(datasourceName, "executeSql", agent);
  if (resolved.failure) return resolved.failure;
  const { datasource, service } = resolved;

  if (!isReadOnlyQuery(sqlQuery)) {
    if (!service.getDataSourceConfig(datasourceName)?.allowWrites) {
      return {
        failed: true,
        message: `**Database** Refused write on read-only datasource '${datasourceName}'`,
        result: `The datasource '${datasourceName}' is configured with allowWrites: false, so only read queries may be run against it. Ask the user to enable writes for this datasource if the change is intended.`,
      };
    }

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
  "Executes an arbitrary SQL query on a datasource. Prefer database_selectRows for simple lookups. WARNING: Use with extreme caution as this can modify or delete data.";

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
