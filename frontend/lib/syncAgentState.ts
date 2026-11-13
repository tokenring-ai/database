import { toastOnReject } from "@tokenring-ai/one-frontend/lib/toastOnReject.ts";
import { databaseRPCClient } from "@tokenring-ai/one-frontend/rpc.ts";
import formatError from "@tokenring-ai/utility/error/formatError";
import type { Row } from "../features/database/types.ts";

/**
 * Points an agent at whatever the user is looking at so its database tools act
 * on the same datasource, table and rows. Best effort: a failure is reported
 * but never blocks the UI.
 */
export function syncAgentDatabaseState(agentId: string, datasource: string, table: string | null, selectedRows: Row[]): void {
  toastOnReject(
    databaseRPCClient.updateDatabaseState({
      agentId,
      datasource,
      // Omit `table` to clear it. The server drops activeTable even when the datasource stays the same.
      ...(table ? { table } : {}),
      selectedRows,
    }),
    { message: error => `Database selection could not be synced to the agent: ${formatError(error)}`, type: "warning", duration: 4000 },
  );
}
