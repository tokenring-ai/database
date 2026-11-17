import formatError from "@tokenring-ai/utility/error/formatError";
import { MAX_ROW_LIMIT } from "../schema.ts";
import type { DataSource, Row } from "../types.ts";
import isReadOnlyQuery from "./isReadOnlyQuery.ts";
import { ReadOnlyViolationError } from "./readOnlyViolation.ts";

/**
 * Runs a user-typed SQL statement for the Query view with the same safety rules
 * the `database_executeSql` tool applies to agents:
 *
 * - Anything {@link isReadOnlyQuery} does not recognise as a read is a write.
 * - A write is refused outright on a datasource configured `allowWrites: false`.
 * - A write on a writable datasource only runs once the caller has confirmed it
 *   (`confirmWrite`); without that the caller gets `confirmationRequired` back
 *   and nothing is executed — the UI's counterpart of the tool's approval prompt.
 * - Returned rows are capped at `maxRows` (at most {@link MAX_ROW_LIMIT}); the
 *   result says when it was truncated.
 */

export type RunQueryResult =
  | {
      status: "success";
      rows: Row[];
      fields: string[];
      /** Rows the statement produced before truncation. */
      rowCount: number;
      truncated: boolean;
      /** Driver-reported changed/returned row count; null when unavailable. */
      affectedRows: number | null;
      elapsedMs: number;
      readOnly: boolean;
    }
  | { status: "confirmationRequired"; message: string }
  | { status: "writeRefused"; message: string }
  | { status: "error"; error: string; elapsedMs: number };

export interface RunQueryOptions {
  datasourceName: string;
  allowWrites: boolean;
  confirmWrite?: boolean | undefined;
  maxRows?: number | undefined;
  /** Injectable clock for tests. */
  now?: () => number;
}

export function clampRowLimit(maxRows: number | undefined): number {
  if (maxRows === undefined || !Number.isFinite(maxRows) || maxRows <= 0) return MAX_ROW_LIMIT;
  return Math.min(Math.floor(maxRows), MAX_ROW_LIMIT);
}

export default async function runQuery(datasource: DataSource, sql: string, options: RunQueryOptions): Promise<RunQueryResult> {
  const now = options.now ?? (() => performance.now());
  const looksReadOnly = isReadOnlyQuery(sql);

  /** The rules for a write: refused on a read-only datasource, and only run once confirmed. */
  const writeBlocked = (): RunQueryResult | null => {
    if (!options.allowWrites) {
      return {
        status: "writeRefused",
        message: `The datasource '${options.datasourceName}' is read-only (allowWrites: false), so only SELECT, WITH, SHOW, DESCRIBE and EXPLAIN statements can run. Enable writes for this datasource to run this statement.`,
      };
    }
    if (!options.confirmWrite) {
      return {
        status: "confirmationRequired",
        message: "This statement can modify data. Run it anyway?",
      };
    }
    return null;
  };

  if (!looksReadOnly) {
    const blocked = writeBlocked();
    if (blocked) return blocked;
  }
  // A statement that looks like a read runs with the database in read-only mode, unless it was
  // already confirmed as a write on a datasource that allows writes: one that writes anyway
  // (nextval(), a function with side effects) is then handled as a write. On a read-only datasource
  // every statement runs read-only, whatever the request says.
  const readOnly = looksReadOnly && !(options.confirmWrite && options.allowWrites);

  const limit = clampRowLimit(options.maxRows);
  const started = now();
  try {
    let result: Awaited<ReturnType<DataSource["executeSql"]>>;
    try {
      result = await datasource.executeSql(sql, { readOnly });
    } catch (error) {
      if (!(error instanceof ReadOnlyViolationError)) throw error;
      // readOnly was true, so either writes are off or the write wasn't confirmed: this stops at a refusal or a question.
      const blocked = writeBlocked();
      if (blocked) return blocked;
      throw error;
    }
    const elapsedMs = Math.max(0, Math.round(now() - started));
    const rowCount = result.rows.length;
    return {
      status: "success",
      rows: rowCount > limit ? result.rows.slice(0, limit) : result.rows,
      fields: result.fields,
      rowCount,
      truncated: rowCount > limit,
      affectedRows: result.affectedRows ?? null,
      elapsedMs,
      readOnly,
    };
  } catch (err) {
    return { status: "error", error: formatError(err), elapsedMs: Math.max(0, Math.round(now() - started)) };
  }
}
