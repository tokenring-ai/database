import { Button, Checkbox, IconButton, TextField } from "@tokenring-ai/one-frontend/ui";
import { KeyRound, X } from "lucide-react";
import { type SubmitEvent, useMemo, useState } from "react";
import { draftFromRow, draftToValues, isLossyColumnType, type RowDraft } from "../rowEdit.ts";
import type { CellValue, ColumnDef, Row } from "../types.ts";

/**
 * Form for one row: editing an existing row (`row` given) or inserting a new
 * one. Only fields the user changes are submitted; a new row leaves untouched
 * fields to the database default. Columns whose values do not survive the trip
 * to the browser (binary, dates, JSON…) can only be set to NULL here.
 */
export default function RowEditPane({
  row,
  columns,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  /** null inserts a new row. */
  row: Row | null;
  columns: ColumnDef[];
  saving: boolean;
  error: string | null;
  onSubmit: (values: Record<string, CellValue>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RowDraft>(() => draftFromRow(row, columns));
  const [showErrors, setShowErrors] = useState(false);
  const { values, errors } = useMemo(() => draftToValues(draft, columns), [draft, columns]);
  const changed = Object.keys(values).length + Object.keys(errors).length > 0;
  const inserting = row === null;

  const setField = (name: string, patch: Partial<RowDraft[string]>) => {
    setDraft(previous => ({ ...previous, [name]: { ...previous[name]!, ...patch, touched: true } }));
  };

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return;
    }
    if (!changed) return;
    onSubmit(values);
  };

  return (
    <aside
      aria-label={inserting ? "New row" : "Edit row"}
      className="absolute inset-0 z-30 w-full bg-secondary flex flex-col min-h-0 lg:relative lg:inset-auto lg:z-auto lg:w-96 lg:shrink-0 lg:border-l lg:border-primary"
    >
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-primary">
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">{inserting ? "New row" : "Edit row"}</span>
        <IconButton variant="ghost" icon={X} label="Cancel editing" onClick={onCancel} />
      </div>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          {inserting && <p className="text-xs text-muted">Fields you leave untouched get the column's default value.</p>}
          {columns.map(column => {
            const field = draft[column.name]!;
            const lossy = isLossyColumnType(column.dataType);
            const fieldError = showErrors ? errors[column.name] : undefined;
            return (
              <div key={column.name}>
                <TextField
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      {column.isPrimaryKey && <KeyRound className="w-2.5 h-2.5 text-warning shrink-0" aria-label="Primary key" />}
                      <span className="font-mono">{column.name}</span>
                      <span className="text-muted font-normal">· {column.dataType}</span>
                    </span>
                  }
                  aria-label={column.name}
                  mono
                  value={field.isNull ? "" : field.text}
                  placeholder={field.isNull ? "NULL" : inserting && !field.touched ? "default" : undefined}
                  disabled={field.isNull || lossy || saving}
                  onChange={text => setField(column.name, { text, isNull: false })}
                  error={fieldError}
                  hint={lossy ? "This type can only be edited with a SQL query." : undefined}
                />
                {column.nullable && (
                  <Checkbox
                    className="mt-1"
                    checked={field.isNull}
                    disabled={saving}
                    onChange={isNull => setField(column.name, { isNull })}
                    label={<span className="text-muted">NULL</span>}
                  />
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <p role="alert" className="shrink-0 px-3 py-2 text-xs text-danger border-t border-primary">
            {error}
          </p>
        )}
        <div className="shrink-0 flex items-center justify-end gap-2 px-3 py-2 border-t border-primary">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" busy={saving} busyLabel="Saving…" disabled={!changed}>
            {inserting ? "Insert row" : "Save row"}
          </Button>
        </div>
      </form>
    </aside>
  );
}
