import AgentLaunchPanel from "@tokenring-ai/one-frontend/components/ui/AgentLaunchPanel.tsx";
import EmptyState from "@tokenring-ai/one-frontend/components/ui/EmptyState.tsx";
import PaginationControls from "@tokenring-ai/one-frontend/components/ui/PaginationControls.tsx";
import ViewHeader from "@tokenring-ai/one-frontend/components/ui/ViewHeader.tsx";
import ViewShell from "@tokenring-ai/one-frontend/components/ui/ViewShell.tsx";
import type { ViewProps } from "@tokenring-ai/one-frontend/dock/types.ts";
import { useConfirmDialog } from "@tokenring-ai/one-frontend/hooks/useConfirmDialog.tsx";
import { useCyclicSort } from "@tokenring-ai/one-frontend/hooks/useCyclicSort.ts";
import { useDebounce } from "@tokenring-ai/one-frontend/hooks/useDebounce.ts";
import { databaseRPCClient, useDatabaseConfiguration, useTableRows, useTableSchema } from "@tokenring-ai/one-frontend/rpc.ts";
import { toastManager } from "@tokenring-ai/one-frontend/ui";
import formatError from "@tokenring-ai/utility/error/formatError";
import { Columns3, Lock, Plus, Table2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DatabaseTableParams } from "../app.tsx";
import FilterBar from "../features/database/components/FilterBar.tsx";
import RowDetailPane from "../features/database/components/RowDetailPane.tsx";
import RowEditPane from "../features/database/components/RowEditPane.tsx";
import RowGrid from "../features/database/components/RowGrid.tsx";
import { DATABASE_AGENT_TYPE, PAGE_SIZE } from "../features/database/constants.ts";
import { draftFiltersToQuery } from "../features/database/filterQuery.ts";
import { rowEditBlockReason, rowKey } from "../features/database/rowEdit.ts";
import type { CellValue, DraftFilter, Row } from "../features/database/types.ts";
import { syncAgentDatabaseState, useDatabaseNavigation } from "../lib/databaseShared.tsx";
import { requestDatabaseAgent, useDatabaseAgentState } from "../lib/databaseStore.ts";

const FILTER_DEBOUNCE_MS = 300;

/**
 * Stable identity for selection / React state. Prefer the primary key when the
 * table has one; otherwise fingerprint the full row so sort/filter/pagination
 * do not reshuffle selection. Index is intentionally not part of the key.
 */
function rowKeyOf(row: Row, primaryKey: string[]): string {
  if (primaryKey.length > 0) {
    return primaryKey.map(column => JSON.stringify(row[column] ?? null)).join("|");
  }
  try {
    return JSON.stringify(row);
  } catch {
    // Non-serializable cell values are rare; collapse them rather than use index
    // (index keys corrupt selection when the page is reordered).
    return "unserializable";
  }
}

/**
 * One table per panel: filter bar, row grid and the single-row detail pane.
 * Opened without params it is the dashboard's placeholder, which the next
 * table picked in the tree fills in place.
 */
export default function DatabaseTableView({ params, panel }: ViewProps<DatabaseTableParams>) {
  const datasource = params.datasource ?? null;
  const table = params.table ?? null;
  const { openAgentChat, openSchema } = useDatabaseNavigation();
  const { attachedAgentId } = useDatabaseAgentState();

  const configuration = useDatabaseConfiguration();
  const datasourceMeta = configuration.data?.datasources.find(entry => entry.name === datasource);
  const allowedAgentTypes = useMemo(() => configuration.data?.agentTypes ?? [DATABASE_AGENT_TYPE], [configuration.data]);
  const defaultAgentType = allowedAgentTypes[0] ?? DATABASE_AGENT_TYPE;

  const [draftFilters, setDraftFilters] = useState<DraftFilter[]>([]);
  // Debounce filter edits so every keystroke doesn't fire a new selectRows call.
  // Empty drafts apply immediately (clear) so we never query with stale filters.
  const debouncedFilters = useDebounce(draftFilters, FILTER_DEBOUNCE_MS);
  const appliedFilters = draftFilters.length === 0 ? draftFilters : debouncedFilters;
  const [offset, setOffset] = useState(0);
  const { orderBy, handleSort, clearSort } = useCyclicSort({ onSortChange: () => setOffset(0) });
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [selectedRowsByKey, setSelectedRowsByKey] = useState<Map<string, Row>>(() => new Map());
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  /** The row being edited, or `{ row: null }` while inserting a new one. */
  const [editing, setEditing] = useState<{ row: Row | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { openConfirm, Dialog: ConfirmDialog } = useConfirmDialog();
  /** AgentLaunchPanel calls attach once per selected key; bulk-sync only on the first call per agent. */
  const preparedAgentRef = useRef<string | null>(null);

  const schemaQuery = useTableSchema(datasource ?? undefined, table ?? undefined);
  const columns = useMemo(() => schemaQuery.data?.schema.columns ?? [], [schemaQuery.data]);
  const primaryKey = useMemo(() => schemaQuery.data?.schema.primaryKey ?? [], [schemaQuery.data]);

  const queryFilters = useMemo(() => draftFiltersToQuery(appliedFilters, columns), [appliedFilters, columns]);

  const rowQuery = useMemo(
    () => ({
      ...(queryFilters.length > 0 ? { filters: queryFilters } : {}),
      ...(orderBy.length > 0 ? { orderBy } : {}),
      limit: PAGE_SIZE,
      offset,
    }),
    [queryFilters, orderBy, offset],
  );

  const rowsQuery = useTableRows(datasource ?? undefined, table ?? undefined, rowQuery);
  const rows = useMemo(() => rowsQuery.data?.rows ?? [], [rowsQuery.data]);
  const fields = rowsQuery.data?.fields ?? columns.map(column => column.name);
  const totalCount = rowsQuery.data?.totalCount ?? null;
  const hasMore = rowsQuery.data?.hasMore ?? false;

  // The placeholder panel becomes the table it is filled with.
  useEffect(() => {
    panel.setTitle(table ?? "Select a table");
  }, [panel, table]);

  // Drop selection / paging / filters when the panel changes table (placeholder fill).
  useEffect(() => {
    setDraftFilters([]);
    clearSort();
    setOffset(0);
    setSelectedKeys(new Set());
    setSelectedRowsByKey(new Map());
    setDetailRow(null);
    setEditing(null);
    setSaveError(null);
  }, [datasource, table, clearSort]);

  // Keep the attached agent pointed at what this panel shows while it is the
  // focused one, so the agent's tools act on the same rows the user sees.
  useEffect(() => {
    if (!attachedAgentId || !datasource || !panel.isActive) return;
    syncAgentDatabaseState(attachedAgentId, datasource, table, Array.from(selectedRowsByKey.values()));
  }, [attachedAgentId, datasource, table, panel.isActive, selectedRowsByKey]);

  const keyOf = useCallback((row: Row, _index: number) => rowKeyOf(row, primaryKey), [primaryKey]);

  const handleFiltersChange = useCallback((next: DraftFilter[]) => {
    setDraftFilters(next);
    setOffset(0);
  }, []);

  const handleToggleRow = useCallback(
    (row: Row, index: number) => {
      const key = keyOf(row, index);
      setSelectedKeys(previous => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setSelectedRowsByKey(previous => {
        const next = new Map(previous);
        if (next.has(key)) next.delete(key);
        else next.set(key, row);
        return next;
      });
    },
    [keyOf],
  );

  const handleToggleAll = useCallback(() => {
    const allKeys = rows.map((row, index) => keyOf(row, index));
    const allSelected = allKeys.length > 0 && allKeys.every(key => selectedKeys.has(key));
    setSelectedKeys(previous => {
      const next = new Set(previous);
      for (const key of allKeys) {
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
    setSelectedRowsByKey(previous => {
      const next = new Map(previous);
      rows.forEach((row, index) => {
        const key = keyOf(row, index);
        if (allSelected) next.delete(key);
        else next.set(key, row);
      });
      return next;
    });
  }, [keyOf, rows, selectedKeys]);

  const clearRowSelection = useCallback(() => {
    setSelectedKeys(new Set());
    setSelectedRowsByKey(new Map());
  }, []);

  /**
   * Domain agents receive the full selection in one `updateDatabaseState` call.
   * The panel invokes this per key, so only the first call for an agent id does work.
   */
  const attachSelectedRowsToAgent = useCallback(
    async (newAgentId: string, _itemId: string) => {
      if (preparedAgentRef.current === newAgentId) return;
      preparedAgentRef.current = newAgentId;
      if (!datasource) return;
      await databaseRPCClient.updateDatabaseState({
        agentId: newAgentId,
        datasource,
        ...(table ? { table } : {}),
        selectedRows: Array.from(selectedRowsByKey.values()),
      });
    },
    [datasource, table, selectedRowsByKey],
  );

  /** The launched agent becomes the dashboard's agent, with its chat docked beside the table. */
  const handleLaunchedAgent = useCallback(
    (agentId: string) => {
      setDetailRow(null);
      requestDatabaseAgent(agentId);
      openAgentChat(agentId);
    },
    [openAgentChat],
  );

  const allowWrites = datasourceMeta?.allowWrites === true;
  const editBlockedReason = rowEditBlockReason(allowWrites, columns, primaryKey);
  const canInsert = allowWrites && columns.length > 0;

  const startEdit = useCallback((row: Row | null) => {
    setSaveError(null);
    setEditing({ row });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setSaveError(null);
  }, []);

  const saveRow = useCallback(
    async (values: Record<string, CellValue>) => {
      if (!datasource || !table || !editing) return;
      setSaving(true);
      setSaveError(null);
      try {
        const original = editing.row;
        const result = original
          ? await databaseRPCClient.mutateRow({ datasource, table, kind: "update", key: rowKey(original, primaryKey), values })
          : await databaseRPCClient.mutateRow({ datasource, table, kind: "insert", values });
        if (result.status === "error") {
          setSaveError(result.error);
          return;
        }
        if (result.status !== "success") {
          setSaveError(result.message);
          return;
        }
        if (original && result.affectedRows === 0) {
          setSaveError("No row matched this row's primary key; it may have been changed or deleted. Refresh and try again.");
          return;
        }
        setEditing(null);
        // The detail pane would show the stale values; the grid refetches.
        setDetailRow(null);
        void rowsQuery.mutate();
      } catch (error) {
        setSaveError(formatError(error));
      } finally {
        setSaving(false);
      }
    },
    [datasource, editing, primaryKey, rowsQuery, table],
  );

  const deleteRow = useCallback(
    async (row: Row) => {
      if (!datasource || !table) return;
      const key = rowKey(row, primaryKey);
      const confirmed = await openConfirm({
        title: "Delete this row?",
        message: `Delete the row of "${table}" where ${Object.entries(key)
          .map(([column, value]) => `${column} = ${JSON.stringify(value)}`)
          .join(" and ")}? This cannot be undone.`,
        confirmText: "Delete row",
        variant: "danger",
        dontAskAgain: false,
      });
      if (!confirmed) return;
      try {
        const result = await databaseRPCClient.mutateRow({ datasource, table, kind: "delete", key });
        if (result.status === "error") throw new Error(result.error);
        if (result.status !== "success") throw new Error(result.message);
        const selectionKey = keyOf(row, 0);
        setSelectedKeys(previous => {
          const next = new Set(previous);
          next.delete(selectionKey);
          return next;
        });
        setSelectedRowsByKey(previous => {
          const next = new Map(previous);
          next.delete(selectionKey);
          return next;
        });
        setDetailRow(null);
        void rowsQuery.mutate();
      } catch (error) {
        toastManager.error(`Could not delete the row: ${formatError(error)}`);
      }
    },
    [datasource, keyOf, openConfirm, primaryKey, rowsQuery, table],
  );

  if (!datasource || !table) {
    return (
      <EmptyState
        variant="page"
        icon={Table2}
        title="Select a table"
        hint={
          datasource
            ? `Browse the tables under "${datasource}" in the datasource tree to inspect their rows.`
            : "Pick a datasource in the tree, then one of its tables, to inspect its rows."
        }
      />
    );
  }

  return (
    <ViewShell
      scroll={false}
      header={
        <ViewHeader
          variant="navigator"
          title={
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="text-sm font-semibold text-primary truncate font-mono">{table}</span>
              {datasourceMeta && !datasourceMeta.allowWrites && (
                <span className="inline-flex items-center gap-1 text-xs text-muted border border-primary rounded px-1.5 py-0.5">
                  <Lock className="w-3 h-3" /> Read-only
                </span>
              )}
              <span className="text-xs text-muted truncate">{datasource}</span>
              <button
                type="button"
                onClick={() => openSchema(datasource, table)}
                className="p-1 text-muted hover:text-primary rounded transition-colors cursor-pointer focus-ring"
                title="Columns and keys"
                aria-label={`Columns of ${table}`}
              >
                <Columns3 className="w-3.5 h-3.5" />
              </button>
              <div className="flex-1" />
              {canInsert && (
                <button
                  type="button"
                  onClick={() => startEdit(null)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted hover:text-primary rounded transition-colors cursor-pointer focus-ring"
                  title="Insert a row"
                >
                  <Plus className="w-3.5 h-3.5" /> Add row
                </button>
              )}
              <PaginationControls
                offset={offset}
                pageSize={PAGE_SIZE}
                // Backend computes hasMore from the same totalCount/limit math; trust it as
                // the sole authority so a stale totalCount alone cannot open an empty page.
                hasMore={hasMore}
                itemCount={rows.length}
                totalCount={totalCount}
                loading={rowsQuery.isLoading}
                selectionCount={selectedKeys.size}
                showRefresh
                onRefresh={() => void rowsQuery.mutate()}
                onPageChange={setOffset}
              />
            </div>
          }
        />
      }
    >
      <FilterBar columns={columns} filters={draftFilters} onChange={handleFiltersChange} />

      <div className="relative flex-1 flex min-h-0">
        <RowGrid
          rows={rows}
          columns={columns}
          fields={fields.length > 0 ? fields : columns.map(column => column.name)}
          orderBy={orderBy}
          selectedKeys={selectedKeys}
          rowKeyOf={keyOf}
          loading={rowsQuery.isLoading || schemaQuery.isLoading}
          error={rowsQuery.error ?? schemaQuery.error}
          onToggleRow={handleToggleRow}
          onToggleAll={handleToggleAll}
          onSort={handleSort}
          onRetry={() => {
            void schemaQuery.mutate();
            void rowsQuery.mutate();
          }}
          onOpenRow={setDetailRow}
          hasActiveFilters={queryFilters.length > 0}
        />
        {editing ? (
          <RowEditPane
            // Remount per row so the form starts from that row's values.
            key={editing.row ? keyOf(editing.row, 0) : "new"}
            row={editing.row}
            columns={columns}
            saving={saving}
            error={saveError}
            onSubmit={values => void saveRow(values)}
            onCancel={cancelEdit}
          />
        ) : (
          detailRow && (
            <RowDetailPane
              row={detailRow}
              columns={columns}
              onClose={() => setDetailRow(null)}
              onEdit={editBlockedReason ? undefined : () => startEdit(detailRow)}
              onDelete={editBlockedReason ? undefined : () => void deleteRow(detailRow)}
              editBlockedReason={allowWrites ? editBlockedReason : null}
            />
          )
        )}
      </div>

      {selectedKeys.size > 0 && (
        <AgentLaunchPanel
          selectedItems={selectedKeys}
          itemLabel="row"
          onClear={clearRowSelection}
          attachItemToAgent={attachSelectedRowsToAgent}
          onNavigateToAgent={handleLaunchedAgent}
          defaultAgentType={defaultAgentType}
          allowedAgentTypes={allowedAgentTypes}
          launchLabel="Open Agent"
        />
      )}
      <ConfirmDialog />
    </ViewShell>
  );
}
