import type { CellValue, ColumnDef, FilterOperator, OrderBy, Row, TableRef, TableSchema } from "@tokenring-ai/database/types";

export type { CellValue, ColumnDef, FilterOperator, OrderBy, Row, TableRef, TableSchema };

/** A datasource as the browser sees it — never includes the connection string. */
export interface DatasourceSummary {
  name: string;
  scheme: string;
  allowWrites: boolean;
  /** "missingSecret": configured, but its connection string has no value, so it cannot connect. */
  status: "ready" | "missingSecret";
}

/** One row of the filter bar. Held as a string until it's sent, so the input stays editable. */
export interface DraftFilter {
  id: string;
  column: string;
  op: FilterOperator;
  value: string;
}
