import type { TableSchema } from "../types.ts";

/** How long a table's columns are trusted without re-reading them. */
const SCHEMA_TTL_MS = 60_000;

/**
 * Table schemas per datasource. They used to be kept until restart, so a column added with
 * ALTER TABLE never appeared and row edits were built against columns that no longer existed.
 * Entries now expire, and the provider clears them whenever it runs SQL that may change the schema.
 */
export class SchemaCache {
  private readonly entries = new Map<string, { schema: TableSchema; at: number }>();

  get(table: string): TableSchema | undefined {
    const entry = this.entries.get(table);
    if (!entry) return undefined;
    if (Date.now() - entry.at > SCHEMA_TTL_MS) {
      this.entries.delete(table);
      return undefined;
    }
    return entry.schema;
  }

  set(table: string, schema: TableSchema): void {
    this.entries.set(table, { schema, at: Date.now() });
  }

  clear(): void {
    this.entries.clear();
  }
}
