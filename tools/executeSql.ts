import type Agent from "@tokenring-ai/agent/Agent";
import { permissionSlug } from "@tokenring-ai/chat";
import { ApprovalLevel, type TokenRingToolDefinition, type TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { requireToolApproval } from "@tokenring-ai/chat/util/requireToolApproval";
import { z } from "zod";
import { MAX_ROW_LIMIT } from "../schema.ts";
import isReadOnlyQuery from "../util/isReadOnlyQuery.ts";
import { ReadOnlyViolationError } from "../util/readOnlyViolation.ts";
import { resolveDatasource } from "../util/resolveDatasource.ts";

// Export the tool name in the required format
const name = "database_executeSql";
const displayName = "Database/executeSql";

async function execute({ datasource: datasourceName, sqlQuery }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const resolved = resolveDatasource(datasourceName, "executeSql", agent);
  if (resolved.failure) return resolved.failure;
  const { datasource, service } = resolved;

  const refuseWrite = (): TokenRingToolResult => ({
    failed: true,
    message: `**Database** Refused write on read-only datasource '${datasourceName}'`,
    result: `The datasource '${datasourceName}' is configured with allowWrites: false, so only read queries may be run against it. Ask the user to enable writes for this datasource if the change is intended.`,
  });
  const approveWrite = async (): Promise<void> => {
    // Level 8 keeps this a person's decision (8 and up are never auto-approved by the classifier) and is the
    // highest level a grant can cover, so "Always allow" is available for this datasource.
    await requireToolApproval(agent, {
      toolName: name,
      message: `Execute SQL write operation on datasource: '${datasourceName}'?\n\nQuery: ${sqlQuery}`,
      detailedDescription: "A database write is a shared change that may not be recoverable.",
      safetyLevel: ApprovalLevel.ReachesPeople,
      default: false,
      permission: { id: `database.${permissionSlug(datasourceName)}.write`, summary: `Run write queries on ${datasourceName} (any statement, any table)` },
    });
  };
  const allowWrites = !!service.getDataSourceConfig(datasourceName)?.allowWrites;

  let result: Awaited<ReturnType<typeof datasource.executeSql>>;
  if (isReadOnlyQuery(sqlQuery)) {
    try {
      // The database enforces it: a read that turns out to write (nextval(), a function with side
      // effects) is refused instead of slipping past the text check.
      result = await datasource.executeSql(sqlQuery, { readOnly: true });
    } catch (error) {
      if (!(error instanceof ReadOnlyViolationError)) throw error;
      if (!allowWrites) return refuseWrite();
      await approveWrite();
      result = await datasource.executeSql(sqlQuery);
    }
  } else {
    if (!allowWrites) return refuseWrite();
    await approveWrite();
    result = await datasource.executeSql(sqlQuery);
  }
  // `SELECT * FROM events` on a big table would otherwise put every row into the model's context.
  const rows = result.rows.slice(0, MAX_ROW_LIMIT);
  const omitted = result.rows.length - rows.length;
  return {
    message: `**Database** Executed SQL${omitted > 0 ? ` (showing ${rows.length} of ${result.rows.length} rows)` : ""}`,
    result: JSON.stringify({
      ...result,
      rows,
      ...(omitted > 0 && {
        truncated: `Only the first ${rows.length} of ${result.rows.length} rows are shown. Add a WHERE, LIMIT or aggregate to the query to see the rest.`,
      }),
    }),
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
