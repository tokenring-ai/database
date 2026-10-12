import CodeEditor from "@tokenring-ai/one-frontend/components/editor/CodeEditor.tsx";
import DataGrid, { type DataGridColumn } from "@tokenring-ai/one-frontend/components/ui/DataGrid.tsx";
import EmptyState from "@tokenring-ai/one-frontend/components/ui/EmptyState.tsx";
import ErrorBanner from "@tokenring-ai/one-frontend/components/ui/ErrorBanner.tsx";
import ErrorState from "@tokenring-ai/one-frontend/components/ui/ErrorState.tsx";
import ViewHeader from "@tokenring-ai/one-frontend/components/ui/ViewHeader.tsx";
import ViewShell from "@tokenring-ai/one-frontend/components/ui/ViewShell.tsx";
import type { ViewProps } from "@tokenring-ai/one-frontend/dock/types.ts";
import { useConfirmDialog } from "@tokenring-ai/one-frontend/hooks/useConfirmDialog.tsx";
import { useKeyboardShortcuts } from "@tokenring-ai/one-frontend/hooks/useKeyboardShortcuts.ts";
import { useLocalStorageState } from "@tokenring-ai/one-frontend/hooks/useLocalStorageState.ts";
import { copyToClipboard } from "@tokenring-ai/one-frontend/lib/clipboard.ts";
import { cn } from "@tokenring-ai/one-frontend/lib/utils.ts";
import { databaseRPCClient, useDatabaseConfiguration } from "@tokenring-ai/one-frontend/rpc.ts";
import { Button, IconButton } from "@tokenring-ai/one-frontend/ui";
import formatError from "@tokenring-ai/utility/error/formatError";
import { Copy, History, Lock, Play, RotateCcw, SquareTerminal, Trash2, X } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import isReadOnlyQuery from "../../util/isReadOnlyQuery.ts";
import type { DatabaseQueryParams } from "../app.tsx";
import RowDetailPane from "../features/database/components/RowDetailPane.tsx";
import type { ColumnDef, Row } from "../features/database/types.ts";
import { type QueryHistoryEntry, queryDraftKey, useQueryHistory } from "../lib/queryHistory.ts";

type ExecuteSqlResult = Awaited<ReturnType<typeof databaseRPCClient.executeSql>>;
type Outcome = { sql: string; result: Exclude<ExecuteSqlResult, { status: "confirmationRequired" }> };

const WRITE_CONFIRM = {
  title: "Run a statement that can modify data?",
  confirmText: "Run statement",
  variant: "danger" as const,
  // Every write is confirmed; there is no "don't ask again" for this one.
  dontAskAgain: false,
};

function writeConfirmMessage(datasource: string): string {
  return `This statement can modify data on "${datasource}". Only SELECT, WITH, SHOW, DESCRIBE and EXPLAIN statements run without confirmation.`;
}

function formatElapsed(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function isCtrlEnter(event: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.key === "Enter" && (event.ctrlKey || event.metaKey);
}

/**
 * A SQL editor bound to one datasource. Reads run straight away; anything the
 * shared read-only detector (`util/isReadOnlyQuery.ts`, the same one the
 * `database_executeSql` tool uses) does not recognise as a read needs an
 * explicit confirmation, and is refused by the server on a read-only
 * datasource. Results are capped server-side at MAX_ROW_LIMIT rows.
 */
export default function DatabaseQueryView({ params, panel }: ViewProps<DatabaseQueryParams>) {
  const { datasource } = params;
  const configuration = useDatabaseConfiguration();
  const datasourceMeta = configuration.data?.datasources.find(entry => entry.name === datasource);
  const allowWrites = datasourceMeta?.allowWrites ?? false;

  const [draft, setDraft] = useLocalStorageState(queryDraftKey(datasource), "");
  // What the editor is (re)mounted with; bumping `version` loads new text into it.
  const [seed, setSeed] = useState(() => ({ text: draft, version: 0 }));
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const history = useQueryHistory(datasource);
  const recordHistory = history.record;
  const { openConfirm, Dialog } = useConfirmDialog();

  useEffect(() => {
    panel.setTitle(`Query · ${datasource}`);
  }, [panel, datasource]);

  const run = useCallback(
    async (sqlOverride?: string) => {
      const sql = (sqlOverride ?? draftRef.current).trim();
      if (!sql || runningRef.current) return;

      // Ask before sending when the client already knows it is a write. A
      // read-only datasource is not asked: the server refuses the write.
      let confirmWrite = false;
      if (allowWrites && !isReadOnlyQuery(sql)) {
        if (!(await openConfirm({ ...WRITE_CONFIRM, message: writeConfirmMessage(datasource) }))) return;
        confirmWrite = true;
      }

      runningRef.current = true;
      setRunning(true);
      setDetailRow(null);
      try {
        let result = await databaseRPCClient.executeSql({ datasource, sql, ...(confirmWrite ? { confirmWrite: true } : {}) });
        // The server is the authority; if it still wants a confirmation, ask now.
        if (result.status === "confirmationRequired") {
          if (!(await openConfirm({ ...WRITE_CONFIRM, message: writeConfirmMessage(datasource) }))) return;
          result = await databaseRPCClient.executeSql({ datasource, sql, confirmWrite: true });
        }
        if (result.status === "confirmationRequired") return;
        setOutcome({ sql, result });
        if (result.status === "success") {
          recordHistory({ sql, status: "success", rowCount: result.rowCount, elapsedMs: result.elapsedMs });
        } else if (result.status === "error") {
          recordHistory({ sql, status: "error", error: result.error, elapsedMs: result.elapsedMs });
        }
      } catch (error) {
        setOutcome({ sql, result: { status: "error", error: formatError(error), elapsedMs: 0 } });
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [allowWrites, datasource, openConfirm, recordHistory],
  );

  // Ctrl/⌘+Enter anywhere in the active panel (buttons, results grid).
  useKeyboardShortcuts([{ key: "Enter", handler: () => void run(), enabled: panel.isActive, allowInEditable: true }]);

  // Monaco binds Ctrl/⌘+Enter itself and stops the event, so catch it on the way down.
  const handleEditorKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!isCtrlEnter(event)) return;
      event.preventDefault();
      event.stopPropagation();
      void run();
    },
    [run],
  );

  const clearHistory = history.clear;
  const handleClearHistory = useCallback(() => {
    void openConfirm({
      title: "Clear query history?",
      message: `Remove every saved statement for "${datasource}" from this browser's history.`,
      confirmText: "Clear history",
      variant: "danger",
    }).then(confirmed => {
      if (confirmed) clearHistory();
    });
  }, [clearHistory, datasource, openConfirm]);

  const loadIntoEditor = useCallback(
    (sql: string) => {
      setDraft(sql);
      setSeed(previous => ({ text: sql, version: previous.version + 1 }));
    },
    [setDraft],
  );

  const rerun = useCallback(
    (entry: QueryHistoryEntry) => {
      loadIntoEditor(entry.sql);
      void run(entry.sql);
    },
    [loadIntoEditor, run],
  );

  const result = outcome?.result;
  const success = result?.status === "success" ? result : null;
  const rows = useMemo(() => success?.rows ?? [], [success]);
  const fields = useMemo(() => success?.fields ?? [], [success]);
  const gridColumns: DataGridColumn[] = useMemo(
    () => fields.map(name => ({ name, sortable: false, isNumeric: rows.length > 0 && typeof rows[0]![name] === "number" })),
    [fields, rows],
  );
  const detailColumns: ColumnDef[] = useMemo(
    () => fields.map(name => ({ name, dataType: "", nullable: true, isPrimaryKey: false, defaultValue: null })),
    [fields],
  );
  const rowKeyOf = useCallback((_row: Record<string, unknown>, index: number) => String(index), []);

  let results: React.ReactNode;
  if (!result) {
    results = (
      <EmptyState
        icon={SquareTerminal}
        title="Run a query to see its results"
        hint={`Press Ctrl/⌘+Enter or Run. ${allowWrites ? "Statements that can modify data ask for confirmation first." : "This datasource is read-only."}`}
      />
    );
  } else if (result.status === "writeRefused") {
    results = (
      <div className="p-3">
        <ErrorBanner title="Write refused" message={result.message} icon={<Lock className="w-4 h-4" />} data-testid="query-write-refused" />
      </div>
    );
  } else if (result.status === "error") {
    results = <ErrorState title="Query failed" error={result.error} onRetry={() => void run(outcome.sql)} className="py-6" />;
  } else if (fields.length === 0) {
    results = (
      <EmptyState
        icon={SquareTerminal}
        title={result.readOnly ? "The query returned no rows" : "Statement executed"}
        hint={
          [
            result.affectedRows !== null && !result.readOnly ? `${result.affectedRows} row${result.affectedRows === 1 ? "" : "s"} affected` : null,
            formatElapsed(result.elapsedMs),
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      />
    );
  } else {
    results = (
      <div className="relative flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <DataGrid
            rows={rows}
            columns={gridColumns}
            fields={fields}
            rowKeyOf={rowKeyOf}
            showSelection={false}
            showDataTypeLabels={false}
            showPrimaryKeyIndicators={false}
            onOpenRow={row => setDetailRow(row as Row)}
            emptyMessage="The query returned no rows."
          />
        </div>
        {detailRow && <RowDetailPane row={detailRow} columns={detailColumns} onClose={() => setDetailRow(null)} />}
      </div>
    );
  }

  return (
    <ViewShell
      scroll={false}
      header={
        <ViewHeader
          variant="navigator"
          title={
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-primary truncate">{datasource}</span>
              {datasourceMeta && !allowWrites && (
                <span className="inline-flex items-center gap-1 text-xs text-muted border border-primary rounded px-1.5 py-0.5">
                  <Lock className="w-3 h-3" /> Read-only
                </span>
              )}
            </div>
          }
        >
          <IconButton
            variant={showHistory ? "secondary" : "ghost"}
            icon={History}
            label={showHistory ? "Hide query history" : "Show query history"}
            aria-pressed={showHistory}
            onClick={() => setShowHistory(open => !open)}
          />
          <Button icon={Play} busy={running} busyLabel="Running…" onClick={() => void run()} disabled={draft.trim() === ""} title="Run (Ctrl/⌘+Enter)">
            Run
          </Button>
        </ViewHeader>
      }
    >
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="h-[40%] min-h-32 shrink-0 border-b border-primary" onKeyDownCapture={handleEditorKeyDownCapture} data-testid="query-editor">
            <CodeEditor key={seed.version} file="query.sql" content={seed.text} onContentChange={setDraft} />
          </div>
          {success && (
            <div className="shrink-0 flex items-center gap-3 px-3 py-1 border-b border-primary text-[11px] text-muted" data-testid="query-summary">
              <span>
                {success.truncated
                  ? `Showing the first ${rows.length} of ${success.rowCount} rows`
                  : `${success.rowCount} row${success.rowCount === 1 ? "" : "s"}`}
              </span>
              <span>{formatElapsed(success.elapsedMs)}</span>
              {success.truncated && <span className="text-warning">Result truncated at the row limit</span>}
            </div>
          )}
          <div className="flex-1 flex flex-col min-h-0 overflow-auto">{results}</div>
        </div>

        {showHistory && (
          <QueryHistoryList
            entries={history.entries}
            onLoad={entry => loadIntoEditor(entry.sql)}
            onRerun={rerun}
            onRemove={history.remove}
            onClear={handleClearHistory}
            onClose={() => setShowHistory(false)}
            disabled={running}
          />
        )}
      </div>
      <Dialog />
    </ViewShell>
  );
}

function QueryHistoryList({
  entries,
  onLoad,
  onRerun,
  onRemove,
  onClear,
  onClose,
  disabled,
}: {
  entries: QueryHistoryEntry[];
  onLoad: (entry: QueryHistoryEntry) => void;
  onRerun: (entry: QueryHistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
  disabled: boolean;
}) {
  return (
    <aside className="w-72 shrink-0 border-l border-primary flex flex-col min-h-0 bg-secondary" aria-label="Query history">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-primary">
        <span className="flex-1 px-1 text-xs font-medium text-muted">History</span>
        {entries.length > 0 && <IconButton variant="ghost" icon={Trash2} label="Clear history" onClick={onClear} />}
        <IconButton variant="ghost" icon={X} label="Close history" onClick={onClose} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted">Statements you run appear here.</p>
        ) : (
          <ul>
            {entries.map(entry => (
              <li key={entry.id} className="group border-b border-primary px-3 py-2" data-testid="query-history-entry">
                <button
                  type="button"
                  onClick={() => onLoad(entry)}
                  className="w-full text-left font-mono text-xs text-primary line-clamp-3 break-all cursor-pointer hover:text-accent focus-ring rounded"
                  title="Load into the editor"
                >
                  {entry.sql}
                </button>
                <div className="mt-1 flex items-center gap-1">
                  <span className={cn("flex-1 min-w-0 truncate text-[11px]", entry.status === "error" ? "text-danger" : "text-muted")}>
                    {new Date(entry.ranAt).toLocaleTimeString()}
                    {entry.status === "error"
                      ? ` · ${entry.error ?? "failed"}`
                      : ` · ${entry.rowCount ?? 0} rows${entry.elapsedMs !== undefined ? ` · ${formatElapsed(entry.elapsedMs)}` : ""}`}
                  </span>
                  <IconButton variant="ghost" icon={RotateCcw} label="Run again" onClick={() => onRerun(entry)} disabled={disabled} />
                  <IconButton variant="ghost" icon={Copy} label="Copy SQL" onClick={() => void copyToClipboard(entry.sql, { label: "SQL" })} />
                  <IconButton variant="ghost" icon={X} label="Remove from history" onClick={() => onRemove(entry.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
