import { useDashboardApi } from "@tokenring-ai/one-frontend/dock/DashboardApiContext.tsx";
import { openInMainArea } from "@tokenring-ai/one-frontend/dock/layout/mainArea.ts";
import { toastOnReject } from "@tokenring-ai/one-frontend/lib/toastOnReject.ts";
import { databaseRPCClient } from "@tokenring-ai/one-frontend/rpc.ts";
import formatError from "@tokenring-ai/utility/error/formatError";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Row } from "../features/database/types.ts";
import { DATABASE_DASHBOARD_ID, DATABASE_QUERY_VIEW, DATABASE_SCHEMA_VIEW, DATABASE_SIDEBAR_VIEWS, DATABASE_TABLE_VIEW } from "../manifest.ts";
import { databasePath } from "./paths.ts";

/** Views whose panels belong to one datasource and close with it. */
const DATASOURCE_SCOPED_VIEWS: ReadonlySet<string> = new Set([DATABASE_TABLE_VIEW, DATABASE_QUERY_VIEW, DATABASE_SCHEMA_VIEW]);

/**
 * Navigation between the Database views. Each action opens the target panel in
 * the main area right away (so a closed panel re-opens even when the URL does
 * not change) and then updates the URL. Rendered on another dashboard, the hook
 * only navigates to the Database dashboard.
 */
export function useDatabaseNavigation() {
  const navigate = useNavigate();
  const dashboard = useDashboardApi();
  const onDashboard = dashboard.dashboardId === DATABASE_DASHBOARD_ID;

  const openTable = useCallback(
    (datasource: string, table: string) => {
      if (onDashboard) {
        openInMainArea(dashboard, DATABASE_TABLE_VIEW, { datasource, table }, { sidebarViews: DATABASE_SIDEBAR_VIEWS, fillPlaceholder: true });
      }
      void navigate(databasePath(datasource, table));
    },
    [dashboard, navigate, onDashboard],
  );

  /** Selecting a datasource only expands it; no table panel is opened until one is picked. */
  const openDatasource = useCallback(
    (datasource: string, options?: { replace?: boolean }) => {
      void navigate(databasePath(datasource), options?.replace ? { replace: true } : undefined);
    },
    [navigate],
  );

  /** Opens (or focuses) the SQL query editor of a datasource. */
  const openQuery = useCallback(
    (datasource: string) => {
      if (onDashboard) {
        openInMainArea(dashboard, DATABASE_QUERY_VIEW, { datasource }, { sidebarViews: DATABASE_SIDEBAR_VIEWS });
        return;
      }
      void navigate(databasePath(datasource));
    },
    [dashboard, navigate, onDashboard],
  );

  /** Opens (or focuses) the columns of one table, or the whole datasource's DDL without a table. */
  const openSchema = useCallback(
    (datasource: string, table?: string) => {
      if (onDashboard) {
        openInMainArea(dashboard, DATABASE_SCHEMA_VIEW, table ? { datasource, table } : { datasource }, { sidebarViews: DATABASE_SIDEBAR_VIEWS });
        return;
      }
      void navigate(databasePath(datasource));
    },
    [dashboard, navigate, onDashboard],
  );

  /** Closes every table, query and schema panel of a datasource (renamed or edited away). */
  const closeTablesOf = useCallback(
    (datasource: string) => {
      if (!onDashboard) return;
      for (const panel of dashboard.listPanels()) {
        if (DATASOURCE_SCOPED_VIEWS.has(panel.viewId) && panel.params.datasource === datasource) dashboard.closeView(panel.panelId);
      }
    },
    [dashboard, onDashboard],
  );

  /** Opens (or focuses) the chat panel for an agent without leaving the dashboard. */
  const openAgentChat = useCallback(
    (agentId: string) => {
      if (onDashboard) dashboard.openView("chat", { agentId }, { position: "right" });
      else void navigate(`/agent/${encodeURIComponent(agentId)}`);
    },
    [dashboard, navigate, onDashboard],
  );

  return { openTable, openDatasource, openQuery, openSchema, closeTablesOf, openAgentChat };
}

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
      ...(table ? { table } : {}),
      selectedRows,
    }),
    { message: error => `Database selection could not be synced to the agent: ${formatError(error)}`, type: "warning", duration: 4000 },
  );
}
