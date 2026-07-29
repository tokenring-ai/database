import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import formatError from "@tokenring-ai/utility/error/formatError";
import { z } from "zod";
import { resolveDatasource } from "../util/resolveDatasource.ts";

const name = "database_describeTable";
const displayName = "Database/describeTable";

async function execute({ datasource: datasourceName, table }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const resolved = resolveDatasource(datasourceName, "describeTable", agent);
  if (resolved.failure) return resolved.failure;

  try {
    const schema = await resolved.datasource.getTableSchema(table);
    return {
      message: `**Database** Described ${table} (${schema.columns.length} columns)`,
      result: JSON.stringify(schema),
    };
  } catch (err) {
    return {
      failed: true,
      message: `**Database** Error while running describeTable`,
      result: `Could not describe table '${table}' on datasource '${datasourceName}': ${formatError(err)}. Use database_listTables to see what exists.`,
    };
  }
}

const description = "Describes one table: its columns, data types, nullability, primary key, and DDL.";

const inputSchema = z.object({
  datasource: z.string().describe("The name of the datasource to target."),
  table: z.string().describe("The name of the table to describe."),
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
