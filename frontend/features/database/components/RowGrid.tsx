import DataGrid, { type DataGridColumn } from "@tokenring-ai/one-frontend/components/ui/DataGrid.tsx";
import { Maximize2 } from "lucide-react";
import { useMemo } from "react";
import { isNumericType } from "../constants.ts";
import type { ColumnDef, OrderBy, Row } from "../types.ts";

/** Pseudo-field for the details-button column; never a real column name in practice. */
const DETAILS_FIELD = "__row_details__";

export default function RowGrid({
  rows,
  columns,
  fields,
  orderBy,
  selectedKeys,
  rowKeyOf,
  loading,
  error,
  onToggleRow,
  onToggleAll,
  onSort,
  onRetry,
  onOpenRow,
  hasActiveFilters = false,
}: {
  rows: Row[];
  columns: ColumnDef[];
  fields: string[];
  orderBy: OrderBy[];
  selectedKeys: Set<string>;
  rowKeyOf: (row: Row, index: number) => string;
  loading: boolean;
  error: unknown;
  onToggleRow: (row: Row, index: number) => void;
  onToggleAll: () => void;
  onSort: (column: string) => void;
  onRetry: () => void;
  onOpenRow: (row: Row) => void;
  /** When true, empty state mentions filters rather than an empty table. */
  hasActiveFilters?: boolean;
}) {
  const gridColumns: DataGridColumn[] = useMemo(
    () => [
      // DataGrid only opens a row on double-click; this per-row button is the
      // keyboard (Tab + Enter) and discoverable path to the same detail pane.
      {
        name: DETAILS_FIELD,
        label: "",
        title: "Row details",
        sortable: false,
        width: "2rem",
        renderCell: (_value, row) => (
          <button
            type="button"
            onClick={() => onOpenRow(row as Row)}
            className="p-0.5 text-muted hover:text-primary rounded cursor-pointer focus-ring"
            aria-label="Row details"
            title="Row details"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        ),
      },
      ...columns.map(column => ({
        name: column.name,
        dataType: column.dataType,
        isPrimaryKey: column.isPrimaryKey,
        isNumeric: isNumericType(column.dataType),
        title: `${column.dataType}${column.nullable ? " · nullable" : ""}`,
      })),
    ],
    [columns, onOpenRow],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <DataGrid
        rows={rows}
        columns={gridColumns}
        fields={[DETAILS_FIELD, ...fields]}
        orderBy={orderBy}
        selectedKeys={selectedKeys}
        rowKeyOf={rowKeyOf as (row: Record<string, unknown>, index: number) => string}
        loading={loading}
        error={error}
        onToggleRow={onToggleRow as (row: Record<string, unknown>, index: number) => void}
        onToggleAll={onToggleAll}
        onSort={onSort}
        onRetry={onRetry}
        onOpenRow={onOpenRow as (row: Record<string, unknown>) => void}
        hasActiveFilters={hasActiveFilters}
        loadingMessage="Loading rows…"
        errorTitle="Failed to load rows"
        emptyMessage="This table has no rows."
        emptyFilteredMessage="No rows match the current filters."
      />
      {rows.length > 0 && (
        <p className="shrink-0 px-3 py-1 border-t border-primary text-[11px] text-muted" data-testid="row-detail-hint">
          Double-click a row, or use its <Maximize2 className="inline w-3 h-3 align-[-2px]" aria-label="details" /> button, to see every column.
        </p>
      )}
    </div>
  );
}
