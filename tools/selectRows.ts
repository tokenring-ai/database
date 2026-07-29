import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import formatError from "@tokenring-ai/utility/error/formatError";
import { z } from "zod";
import { OrderBySchema, RowFilterSchema } from "../schema.ts";
import { resolveDatasource } from "../util/resolveDatasource.ts";

const name = "database_selectRows";
const displayName = "Database/selectRows";

async function execute(
  { datasource: datasourceName, table, columns, filters, orderBy, limit, offset }: z.output<typeof inputSchema>,
  agent: Agent,
): Promise<TokenRingToolResult> {
  const resolved = resolveDatasource(datasourceName, "selectRows", agent);
  if (resolved.failure) return resolved.failure;

  try {
    const result = await resolved.datasource.selectRows({
      table,
      ...(columns ? { columns } : {}),
      ...(filters ? { filters } : {}),
      ...(orderBy ? { orderBy } : {}),
      limit,
      offset,
    });
    const shown = `${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`;
    const of = result.totalCount === null ? "" : ` of ${result.totalCount}`;
    return {
      message: `**Database** Selected ${shown}${of} from ${table}`,
      result: JSON.stringify(result),
    };
  } catch (err) {
    // buildSelect rejects unknown identifiers by design — surfacing the message
    // tells the model which columns it can actually use.
    return {
      failed: true,
      message: `**Database** Error while running selectRows`,
      result: `${formatError(err)}. Use database_describeTable to see the table's columns.`,
    };
  }
}

const description =
  "Reads rows from a table with simple column selection, filtering, sorting and paging. Prefer this over database_executeSql for straightforward lookups — it is parameterized and cannot modify data.";

const inputSchema = z.object({
  datasource: z.string().describe("The name of the datasource to target."),
  table: z.string().describe("The table to read from."),
  columns: z.array(z.string()).exactOptional().describe("Columns to return. Omit for all columns."),
  filters: z
    .array(RowFilterSchema)
    .exactOptional()
    .describe("Conditions combined with AND. Operators: eq, ne, lt, lte, gt, gte, like, in (value is an array), isNull, isNotNull (no value)."),
  orderBy: z.array(OrderBySchema).exactOptional().describe("Sort columns, applied in order."),
  limit: z.number().int().positive().max(1000).default(100).describe("Maximum rows to return (max 1000)."),
  offset: z.number().int().min(0).default(0).describe("Rows to skip, for paging."),
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
