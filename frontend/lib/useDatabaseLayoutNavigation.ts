import { useLayoutApi } from "@tokenring-ai/one-frontend/layout/context.ts";
import { usePaneLink } from "@tokenring-ai/one-frontend/layout/hooks.ts";
import { useCallback } from "react";
import { DATABASE_QUERY_VIEW_ID, DATABASE_SCHEMA_VIEW_ID, DATABASE_START_VIEW_ID, DATABASE_TABLE_VIEW_ID } from "../ids.ts";

/** Views whose panels belong to one datasource and close with it. */
const DATASOURCE_SCOPED_VIEWS: ReadonlySet<string> = new Set([DATABASE_TABLE_VIEW_ID, DATABASE_QUERY_VIEW_ID, DATABASE_SCHEMA_VIEW_ID]);

/**
 * Navigation between the Database views on the layout engine. Opening a table
 * navigates to its URL (the engine opens and focuses its tab); the "Select a
 * table" landing tab has done its job then, so it closes.
 */
export function useDatabaseLayoutNavigation() {
  const api = useLayoutApi();
  const open = usePaneLink();

  const openTable = useCallback(
    (datasource: string, table: string) => {
      open(DATABASE_TABLE_VIEW_ID, { datasource, table });
    },
    [open],
  );

  /** Selecting a datasource only expands it; no table panel is opened until one is picked. */
  const openDatasource = useCallback((datasource: string) => open(DATABASE_START_VIEW_ID, datasource ? { datasource } : {}), [open]);

  /** Opens (or focuses) the SQL query editor of a datasource. */
  const openQuery = useCallback((datasource: string) => open(DATABASE_QUERY_VIEW_ID, { datasource }), [open]);

  /** Opens (or focuses) the columns of one table, or the whole datasource's DDL without a table. */
  const openSchema = useCallback((datasource: string, table?: string) => open(DATABASE_SCHEMA_VIEW_ID, table ? { datasource, table } : { datasource }), [open]);

  /** Closes every table, query and schema panel of a datasource (renamed or edited away). */
  const closeTablesOf = useCallback(
    (datasource: string) => {
      for (const panel of Object.values(api.store.getState().panels)) {
        if (DATASOURCE_SCOPED_VIEWS.has(panel.viewId) && panel.params.datasource === datasource) api.close(panel.key);
      }
    },
    [api],
  );

  /** Opens (or focuses) the chat panel for an agent without leaving the app. */
  const openAgentChat = useCallback((agentId: string) => open("chat", { agentId }, { beside: { edge: "right" } }), [open]);

  return { openTable, openDatasource, openQuery, openSchema, closeTablesOf, openAgentChat };
}
