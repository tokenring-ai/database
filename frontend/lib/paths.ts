/** React-free route helpers shared by the dashboard definition and the views. */

export const DATABASE_PATH = "/database";

/**
 * `/database`, `/database/<datasource>` or `/database/<datasource>/<table>`.
 * A table without a datasource is meaningless, so it is dropped.
 */
export function databasePath(datasource: string | null | undefined, table?: string | null): string {
  if (!datasource) return DATABASE_PATH;
  const base = `${DATABASE_PATH}/${encodeURIComponent(datasource)}`;
  return table ? `${base}/${encodeURIComponent(table)}` : base;
}
