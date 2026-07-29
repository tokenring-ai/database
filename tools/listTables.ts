import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import markdownList from "@tokenring-ai/utility/string/markdownList";
import { z } from "zod";
import { resolveDatasource } from "../util/resolveDatasource.ts";

const name = "database_listTables";
const displayName = "Database/listTables";

async function execute({ datasource: datasourceName }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const resolved = resolveDatasource(datasourceName, "listTables", agent);
  if (resolved.failure) return resolved.failure;

  const tables = await resolved.datasource.listTables();
  if (tables.length === 0) {
    return {
      message: `**Database** No tables in ${datasourceName}`,
      result: `The datasource '${datasourceName}' has no tables or views.`,
    };
  }

  return {
    message: `**Database** Listed ${tables.length} table${tables.length === 1 ? "" : "s"} in ${datasourceName}`,
    result: markdownList(tables.map(table => (table.type === "view" ? `${table.name} (view)` : table.name))),
  };
}

const description = "Lists the tables and views available on a datasource. Use this before describing a table or selecting rows.";

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
