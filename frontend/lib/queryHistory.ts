import { useLocalStorageState } from "@tokenring-ai/one-frontend/hooks/useLocalStorageState.ts";
import { useCallback, useMemo } from "react";

/**
 * Per-datasource history of statements run from the Query view, newest first.
 * Kept in localStorage (this browser only) under one key, capped per datasource.
 */

export const QUERY_HISTORY_KEY = "database:queryHistory";
/** Unsaved editor text of a datasource's query panel. */
export const queryDraftKey = (datasource: string) => `database:queryDraft:${datasource}`;
export const QUERY_HISTORY_CAP = 50;

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  /** Epoch ms. */
  ranAt: number;
  status: "success" | "error";
  rowCount?: number;
  elapsedMs?: number;
  error?: string;
}

export type QueryHistory = Record<string, QueryHistoryEntry[]>;

function isEntry(value: unknown): value is QueryHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" && typeof entry.sql === "string" && typeof entry.ranAt === "number" && (entry.status === "success" || entry.status === "error")
  );
}

/** Entries of one datasource from whatever is stored; anything malformed is dropped. */
export function historyFor(history: unknown, datasource: string): QueryHistoryEntry[] {
  if (!history || typeof history !== "object" || Array.isArray(history)) return [];
  const list = (history as Record<string, unknown>)[datasource];
  return Array.isArray(list) ? list.filter(isEntry) : [];
}

/**
 * Puts `entry` first. Re-running a statement moves it to the top instead of
 * duplicating it; the list is capped at `cap`, dropping the oldest.
 */
export function addHistoryEntry(history: unknown, datasource: string, entry: QueryHistoryEntry, cap = QUERY_HISTORY_CAP): QueryHistory {
  const base: QueryHistory = history && typeof history === "object" && !Array.isArray(history) ? { ...(history as QueryHistory) } : {};
  const sql = entry.sql.trim();
  const rest = historyFor(base, datasource).filter(existing => existing.sql.trim() !== sql);
  base[datasource] = [entry, ...rest].slice(0, Math.max(1, cap));
  return base;
}

export function removeHistoryEntry(history: unknown, datasource: string, id: string): QueryHistory {
  const base: QueryHistory = history && typeof history === "object" && !Array.isArray(history) ? { ...(history as QueryHistory) } : {};
  base[datasource] = historyFor(base, datasource).filter(entry => entry.id !== id);
  return base;
}

export function clearHistory(history: unknown, datasource: string): QueryHistory {
  const base: QueryHistory = history && typeof history === "object" && !Array.isArray(history) ? { ...(history as QueryHistory) } : {};
  delete base[datasource];
  return base;
}

let counter = 0;
export function newHistoryId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

/** The history of one datasource plus mutators. Panels sharing the key stay in sync. */
export function useQueryHistory(datasource: string) {
  const [history, setHistory] = useLocalStorageState<QueryHistory>(QUERY_HISTORY_KEY, {});
  const entries = useMemo(() => historyFor(history, datasource), [history, datasource]);

  const record = useCallback(
    (entry: Omit<QueryHistoryEntry, "id" | "ranAt">) => {
      setHistory(previous => addHistoryEntry(previous, datasource, { ...entry, id: newHistoryId(), ranAt: Date.now() }));
    },
    [datasource, setHistory],
  );
  const remove = useCallback((id: string) => setHistory(previous => removeHistoryEntry(previous, datasource, id)), [datasource, setHistory]);
  const clear = useCallback(() => setHistory(previous => clearHistory(previous, datasource)), [datasource, setHistory]);

  return { entries, record, remove, clear };
}
