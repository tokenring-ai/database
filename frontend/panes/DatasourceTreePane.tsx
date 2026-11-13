import { formatTableRef } from "@tokenring-ai/database/util/tableRef";
import { useAttachedAgentChat } from "@tokenring-ai/one-frontend/apps/chat/useAttachedAgentChat.ts";
import { useRouteParamsFor } from "@tokenring-ai/one-frontend/apps/panelHooks.ts";
import AgentSessionList from "@tokenring-ai/one-frontend/components/AgentSessionList.tsx";
import NavigationSidebarHeader from "@tokenring-ai/one-frontend/components/layout/NavigationSidebarHeader.tsx";
import ErrorState from "@tokenring-ai/one-frontend/components/ui/ErrorState.tsx";
import ListItemWithActions from "@tokenring-ai/one-frontend/components/ui/ListItemWithActions.tsx";
import LoadingState from "@tokenring-ai/one-frontend/components/ui/LoadingState.tsx";
import SearchInput from "@tokenring-ai/one-frontend/components/ui/SearchInput.tsx";
import ViewShell from "@tokenring-ai/one-frontend/components/ui/ViewShell.tsx";
import { useAppAgentSession } from "@tokenring-ai/one-frontend/hooks/useAppAgentSession.tsx";
import { useSearchFilter } from "@tokenring-ai/one-frontend/hooks/useSearchFilter.ts";
import { cn } from "@tokenring-ai/one-frontend/lib/utils.ts";
import { useDatabaseConfiguration, useDatabaseTables } from "@tokenring-ai/one-frontend/rpc.ts";
import { AlertTriangle, ChevronRight, Columns3, Database, Eye, FileCode2, Lock, Pencil, Plus, RefreshCw, SquareTerminal, Table2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DatasourceFormModal from "../features/database/components/DatasourceFormModal.tsx";
import { DATABASE_AGENT_TYPE } from "../features/database/constants.ts";
import type { DatasourceSummary } from "../features/database/types.ts";
import { DATABASE_QUERY_VIEW_ID, DATABASE_SCHEMA_VIEW_ID, DATABASE_START_VIEW_ID, DATABASE_TABLE_VIEW_ID } from "../ids.ts";
import { clearDatabaseAgentRequest, setAttachedDatabaseAgent, useDatabaseAgentState } from "../lib/databaseStore.ts";
import { syncAgentDatabaseState } from "../lib/syncAgentState.ts";
import { useDatabaseLayoutNavigation } from "../lib/useDatabaseLayoutNavigation.ts";

/**
 * Agents the Database dashboard can attach to; keeps the chat panel docked
 * beside the tables and publishes the attached agent to the table panels.
 */
function DatabaseAgentSessions({ agentTypes, datasource, tableSelected }: { agentTypes: string[]; datasource: string | null; tableSelected: boolean }) {
  const { agentId, agents, isLoading, selectAgent, createAgent, terminateAgent, TerminateDialog } = useAppAgentSession({
    appName: "Database dashboard",
    storageKey: "database",
    agentTypes,
  });
  useAttachedAgentChat({ agentId });
  const { requestedAgentId } = useDatabaseAgentState();

  // Table panels read the attached agent from the store (they own the row selection).
  useEffect(() => {
    setAttachedDatabaseAgent(agentId);
    return () => setAttachedDatabaseAgent(null);
  }, [agentId]);

  // A table panel that launched an agent with its selection hands it over here.
  useEffect(() => {
    if (!requestedAgentId) return;
    clearDatabaseAgentRequest();
    if (requestedAgentId !== agentId) selectAgent(requestedAgentId);
  }, [agentId, requestedAgentId, selectAgent]);

  // With no table open there is no table panel to publish the selection, so the
  // navigator points the agent at the datasource the user is browsing.
  useEffect(() => {
    if (!agentId || !datasource || tableSelected) return;
    syncAgentDatabaseState(agentId, datasource, null, []);
  }, [agentId, datasource, tableSelected]);

  return (
    <>
      <AgentSessionList
        agents={agents}
        selectedAgentId={agentId}
        isLoading={isLoading}
        storageKey="database"
        label="Database agents"
        onSelect={selectAgent}
        onCreate={() => void createAgent()}
        onTerminate={id => void terminateAgent(id)}
      />
      <TerminateDialog />
    </>
  );
}

/** Postgres (and postgresql) are the schemes whose provider parses `schema.table`. */
function usesSchemaQualifiedTables(scheme: string): boolean {
  return scheme === "postgres" || scheme === "postgresql";
}

/**
 * Id passed through the table URL and `resolveTable`. Postgres carries schema
 * and name, quoted so a `.` inside either is not the separator. MySQL and
 * SQLite look the bare name up and do not parse a schema separator.
 */
function tableOpenId(scheme: string, table: { schema?: string; name: string }): string {
  if (!usesSchemaQualifiedTables(scheme)) return table.name;
  return formatTableRef(table);
}

/**
 * The Database dashboard's navigator: the configured datasources, with the open
 * one expanded in place into its tables. Tables are only fetched for the
 * expanded datasource, so opening the dashboard doesn't connect to every
 * configured database at once. Rows open a table panel in the main area;
 * elsewhere (the home dashboard) they navigate to the Database dashboard.
 */
export default function DatasourceTreePane() {
  const tableRoute = useRouteParamsFor(DATABASE_TABLE_VIEW_ID);
  const startRoute = useRouteParamsFor(DATABASE_START_VIEW_ID);
  const queryRoute = useRouteParamsFor(DATABASE_QUERY_VIEW_ID);
  const schemaRoute = useRouteParamsFor(DATABASE_SCHEMA_VIEW_ID);
  // A query or schema tab points the URL at its datasource, so the tree follows it.
  const routeDatasource = (tableRoute ?? startRoute ?? queryRoute ?? schemaRoute)?.datasource;
  const routeTable = tableRoute?.table;
  const { openTable, openDatasource, openQuery, openSchema, closeTablesOf } = useDatabaseLayoutNavigation();

  const configuration = useDatabaseConfiguration();
  const datasources = useMemo<DatasourceSummary[]>(() => configuration.data?.datasources ?? [], [configuration.data]);
  const agentTypes = useMemo(() => configuration.data?.agentTypes ?? [DATABASE_AGENT_TYPE], [configuration.data]);

  const [formMode, setFormMode] = useState<{ existing?: DatasourceSummary } | null>(null);

  // The URL is the source of truth; until it names a valid datasource the first
  // configured one is expanded, which is where browsing used to start.
  const activeDatasource = useMemo(() => {
    if (routeDatasource && datasources.some(entry => entry.name === routeDatasource)) return routeDatasource;
    return (datasources.find(entry => entry.status !== "missingSecret") ?? datasources[0])?.name ?? null;
  }, [datasources, routeDatasource]);
  const activeEntry = datasources.find(entry => entry.name === activeDatasource);
  // A datasource without a connection string can't be connected to; don't try.
  const activeReady = activeEntry !== undefined && activeEntry.status !== "missingSecret";
  const activeTable = routeTable ?? null;

  const tablesQuery = useDatabaseTables(activeReady ? (activeDatasource ?? undefined) : undefined);
  const tables = useMemo(() => tablesQuery.data?.tables ?? [], [tablesQuery.data]);

  const {
    query: tableFilter,
    setQuery: setTableFilter,
    filtered: filteredTables,
    clear: clearTableFilter,
  } = useSearchFilter({
    items: tables,
    searchFields: table => table.name,
  });

  // A filter typed for one datasource shouldn't hide tables after switching.
  useEffect(() => {
    clearTableFilter();
  }, [activeDatasource, clearTableFilter]);

  const handleRefresh = useCallback(() => {
    void configuration.mutate();
    void tablesQuery.mutate();
  }, [configuration, tablesQuery]);

  const handleSelectDatasource = useCallback(
    (name: string) => {
      if (name === routeDatasource) return;
      openDatasource(name);
    },
    [openDatasource, routeDatasource],
  );

  const handleSaved = useCallback(
    (previousName: string | undefined, name: string) => {
      // A rename leaves panels pointing at a datasource that no longer exists.
      if (previousName && previousName !== name) closeTablesOf(previousName);
      void configuration.mutate().then(() => openDatasource(name));
    },
    [closeTablesOf, configuration, openDatasource],
  );

  const handleDeleted = useCallback(
    (name: string) => {
      closeTablesOf(name);
      void configuration.mutate().then(() => {
        if (routeDatasource === name) openDatasource("");
      });
    },
    [closeTablesOf, configuration, openDatasource, routeDatasource],
  );

  let body: React.ReactNode;
  if (configuration.isLoading && datasources.length === 0) {
    body = <LoadingState message="Loading datasources…" size="sm" className="py-8" />;
  } else if (configuration.error && datasources.length === 0) {
    body = <ErrorState title="Failed to load datasources" error={configuration.error} onRetry={handleRefresh} variant="inline" className="py-6" />;
  } else if (datasources.length === 0) {
    body = (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center px-4">
        <Database className="w-8 h-8 text-muted opacity-30" />
        <p className="text-sm text-muted">No datasources configured</p>
        <p className="text-xs text-muted max-w-60">Connect a MySQL/MariaDB, PostgreSQL or SQLite database to browse its tables and hand rows to an agent.</p>
        <button
          type="button"
          onClick={() => setFormMode({})}
          className="text-xs text-accent hover:text-accent-soft cursor-pointer transition-colors focus-ring"
        >
          Add your first datasource →
        </button>
        <p className="text-xs text-muted">
          or set <code className="font-mono">database.datasources</code> in{" "}
          <Link to="/configuration" className="text-accent hover:text-accent-soft focus-ring">
            Configuration
          </Link>
        </p>
      </div>
    );
  } else {
    body = datasources.map(datasource => {
      const isActive = datasource.name === activeDatasource;
      const missingSecret = datasource.status === "missingSecret";
      return (
        <div key={datasource.name}>
          <ListItemWithActions
            id={datasource.name}
            selected={isActive}
            onPrimary={() => handleSelectDatasource(datasource.name)}
            primaryProps={{ "aria-expanded": isActive, "aria-label": `Open datasource ${datasource.name}` }}
            className={cn("w-full gap-2 px-3 py-2 rounded-none border-b border-primary border-l-2", isActive ? "border-l-accent" : "border-l-transparent")}
            action={
              <span className="flex items-center">
                {!missingSecret && (
                  <>
                    <button
                      type="button"
                      onClick={() => openQuery(datasource.name)}
                      className="p-1 text-muted hover:text-primary rounded transition-all cursor-pointer focus-ring"
                      title={`Query ${datasource.name}`}
                      aria-label={`Query ${datasource.name}`}
                    >
                      <SquareTerminal className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openSchema(datasource.name)}
                      className="p-1 text-muted hover:text-primary rounded transition-all cursor-pointer focus-ring"
                      title={`Schema of ${datasource.name}`}
                      aria-label={`Schema of ${datasource.name}`}
                    >
                      <FileCode2 className="w-3 h-3" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setFormMode({ existing: datasource })}
                  className="p-1 text-muted hover:text-primary rounded transition-all cursor-pointer focus-ring"
                  title={`Edit ${datasource.name}`}
                  aria-label={`Edit ${datasource.name}`}
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </span>
            }
          >
            <span className="flex items-center gap-2 min-w-0">
              <ChevronRight className={cn("w-3.5 h-3.5 shrink-0 text-muted transition-transform", isActive && "rotate-90")} />
              <Database className={cn("w-4 h-4 shrink-0", isActive ? "text-cyan-400" : "text-muted")} />
              <span className={cn("text-sm truncate", isActive ? "text-primary font-medium" : "text-secondary")}>{datasource.name}</span>
              {!datasource.allowWrites && <Lock className="w-3 h-3 shrink-0 text-muted" aria-label="Read-only" />}
              {missingSecret && (
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 shrink-0 text-[10px] font-semibold text-amber-500 bg-amber-500/10 rounded"
                  title="Its connection string secret has no value"
                >
                  <AlertTriangle className="w-3 h-3" aria-hidden="true" /> No connection string
                </span>
              )}
            </span>
          </ListItemWithActions>

          {isActive && missingSecret && (
            <div className="bg-primary/40 px-3 py-3 text-xs text-muted" data-testid="datasource-missing-secret">
              <p>This datasource is configured, but its connection string is not set, so it cannot connect.</p>
              <button
                type="button"
                onClick={() => setFormMode({ existing: datasource })}
                className="mt-1.5 text-accent hover:text-accent-soft cursor-pointer transition-colors focus-ring"
              >
                Set connection string →
              </button>
            </div>
          )}

          {isActive && !missingSecret && (
            <div className="bg-primary/40">
              {tables.length > 8 && (
                <div className="px-3 py-1.5 border-b border-primary">
                  <SearchInput value={tableFilter} onChange={setTableFilter} placeholder="Filter tables…" aria-label="Filter tables" />
                </div>
              )}

              {tablesQuery.isLoading && tables.length === 0 ? (
                <LoadingState message="Loading tables…" size="sm" className="py-6" />
              ) : tablesQuery.error ? (
                <ErrorState title="Failed to load tables" error={tablesQuery.error} onRetry={handleRefresh} variant="inline" className="py-4" />
              ) : filteredTables.length === 0 ? (
                <p className="text-xs text-muted px-3 py-4 text-center">{tableFilter ? `No tables matching "${tableFilter}"` : "No tables"}</p>
              ) : (
                filteredTables.map(table => {
                  const openId = tableOpenId(datasource.scheme, table);
                  const showSchema = usesSchemaQualifiedTables(datasource.scheme) && table.schema !== undefined;
                  const label = showSchema ? `${table.schema}.${table.name}` : table.name;
                  const selected = openId === activeTable;
                  return (
                    <div
                      key={`${table.schema ?? ""}.${table.name}`}
                      className={cn("group flex items-center hover:bg-hover transition-colors", selected && "bg-active")}
                    >
                      <button
                        type="button"
                        onClick={() => openTable(datasource.name, openId)}
                        className={cn(
                          "flex-1 min-w-0 flex items-center gap-2 pl-8 pr-1 py-1.5 text-left cursor-pointer focus-ring",
                          selected ? "text-primary font-medium" : "text-muted hover:text-primary",
                        )}
                        aria-current={selected ? "true" : undefined}
                      >
                        {table.type === "view" ? <Eye className="w-3.5 h-3.5 shrink-0" /> : <Table2 className="w-3.5 h-3.5 shrink-0" />}
                        <span className="text-xs truncate">{label}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openSchema(datasource.name, openId)}
                        className="mr-2 p-1 shrink-0 text-muted hover:text-primary rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer focus-ring"
                        title={`Columns of ${label}`}
                        aria-label={`Columns of ${label}`}
                      >
                        <Columns3 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <ViewShell
      tone="sidebar"
      scroll={false}
      header={
        <NavigationSidebarHeader
          actions={[
            { key: "refresh", icon: <RefreshCw className="w-3 h-3" />, label: "Refresh", title: "Refresh", onClick: handleRefresh },
            { key: "add", icon: <Plus className="w-3.5 h-3.5" />, label: "Add datasource", title: "Add datasource", onClick: () => setFormMode({}) },
          ]}
        />
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto">{body}</div>

      <div className="shrink-0 border-t border-primary">
        <DatabaseAgentSessions agentTypes={agentTypes} datasource={activeDatasource} tableSelected={activeTable !== null} />
      </div>

      {formMode && (
        <DatasourceFormModal
          {...(formMode.existing ? { existing: formMode.existing } : {})}
          onClose={() => setFormMode(null)}
          onSaved={name => handleSaved(formMode.existing?.name, name)}
          onDeleted={handleDeleted}
        />
      )}
    </ViewShell>
  );
}
