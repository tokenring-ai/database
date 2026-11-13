import type { ViewParams } from "@tokenring-ai/one-frontend/layout/types.ts";

/**
 * One panel per datasource + table pair. Each part is URI-encoded so a `/`
 * inside a name cannot make two pairs share a key (`a/b` + `c` vs `a` + `b/c`).
 */
export function databaseTableInstanceKey(params: ViewParams): string {
  return `${encodeURIComponent(params.datasource ?? "")}/${encodeURIComponent(params.table ?? "")}`;
}

/** One query editor per datasource. */
export function databaseQueryInstanceKey(params: ViewParams): string {
  return encodeURIComponent(params.datasource ?? "");
}

/** One schema panel per table, plus one per datasource for its full DDL; encoded like the table key. */
export function databaseSchemaInstanceKey(params: ViewParams): string {
  const datasource = encodeURIComponent(params.datasource ?? "");
  return params.table ? `${datasource}/${encodeURIComponent(params.table)}` : datasource;
}
