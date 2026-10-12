import EmptyState from "@tokenring-ai/one-frontend/components/ui/EmptyState.tsx";
import ErrorState from "@tokenring-ai/one-frontend/components/ui/ErrorState.tsx";
import LoadingState from "@tokenring-ai/one-frontend/components/ui/LoadingState.tsx";
import SearchInput from "@tokenring-ai/one-frontend/components/ui/SearchInput.tsx";
import ViewHeader from "@tokenring-ai/one-frontend/components/ui/ViewHeader.tsx";
import ViewShell from "@tokenring-ai/one-frontend/components/ui/ViewShell.tsx";
import type { ViewProps } from "@tokenring-ai/one-frontend/dock/types.ts";
import { useTableSchema } from "@tokenring-ai/one-frontend/rpc.ts";
import { Button } from "@tokenring-ai/one-frontend/ui";
import { Columns3, KeyRound, RefreshCw, SquareTerminal, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DatabaseSchemaParams } from "../app.tsx";
import { useDatasourceDdl } from "../lib/databaseQueries.ts";
import { useDatabaseNavigation } from "../lib/databaseShared.tsx";

/**
 * Schema browser. With a table: its columns (name, type, nullability, default,
 * primary key, comment) and its DDL. Without: the DDL of every table of the
 * datasource (`showSchema`), each linking to its columns.
 */
export default function DatabaseSchemaView({ params, panel }: ViewProps<DatabaseSchemaParams>) {
  const { datasource, table } = params;

  useEffect(() => {
    panel.setTitle(table ? `${table} columns` : `Schema · ${datasource}`);
  }, [panel, datasource, table]);

  return table ? <TableColumns datasource={datasource} table={table} /> : <DatasourceDdl datasource={datasource} />;
}

function TableColumns({ datasource, table }: { datasource: string; table: string }) {
  const { openTable, openQuery } = useDatabaseNavigation();
  const schemaQuery = useTableSchema(datasource, table);
  const schema = schemaQuery.data?.schema;

  let body: React.ReactNode;
  if (schemaQuery.isLoading && !schema) {
    body = <LoadingState message="Loading columns…" size="sm" className="py-8" />;
  } else if (schemaQuery.error && !schema) {
    body = <ErrorState title="Failed to load columns" error={schemaQuery.error} onRetry={() => void schemaQuery.mutate()} className="py-6" />;
  } else if (!schema || schema.columns.length === 0) {
    body = <EmptyState icon={Columns3} title="No columns" hint={`"${table}" reported no columns.`} />;
  } else {
    body = (
      <div className="p-3 space-y-4">
        <div className="overflow-x-auto border border-primary rounded">
          <table className="w-full text-xs" aria-label={`Columns of ${table}`}>
            <thead className="bg-secondary text-muted">
              <tr>
                <th className="text-left font-medium px-2 py-1.5 w-6">
                  <span className="sr-only">Primary key</span>
                </th>
                <th className="text-left font-medium px-2 py-1.5">Column</th>
                <th className="text-left font-medium px-2 py-1.5">Type</th>
                <th className="text-left font-medium px-2 py-1.5">Nullable</th>
                <th className="text-left font-medium px-2 py-1.5">Default</th>
                <th className="text-left font-medium px-2 py-1.5">Comment</th>
              </tr>
            </thead>
            <tbody>
              {schema.columns.map(column => (
                <tr key={column.name} className="border-t border-primary" data-testid="schema-column">
                  <td className="px-2 py-1.5">{column.isPrimaryKey && <KeyRound className="w-3 h-3 text-warning" aria-label="Primary key" />}</td>
                  <td className="px-2 py-1.5 font-mono text-primary">{column.name}</td>
                  <td className="px-2 py-1.5 font-mono text-secondary">{column.dataType}</td>
                  <td className="px-2 py-1.5 text-muted">{column.nullable ? "yes" : "no"}</td>
                  <td className="px-2 py-1.5 font-mono text-muted">{column.defaultValue ?? ""}</td>
                  <td className="px-2 py-1.5 text-muted">{column.comment ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          {schema.primaryKey.length > 0 ? (
            <>
              Primary key: <span className="font-mono text-secondary">{schema.primaryKey.join(", ")}</span>
            </>
          ) : (
            "No primary key."
          )}
        </p>
        {schema.ddl && (
          <details>
            <summary className="cursor-pointer text-xs text-muted hover:text-primary">Definition</summary>
            <pre className="mt-2 p-2 text-xs font-mono whitespace-pre-wrap break-all bg-secondary border border-primary rounded">{schema.ddl}</pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <ViewShell
      scroll
      header={
        <ViewHeader
          variant="navigator"
          title={
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-primary truncate font-mono">{table}</span>
              <span className="text-xs text-muted truncate">{datasource}</span>
            </div>
          }
          actions={[{ key: "refresh", icon: <RefreshCw className="w-3 h-3" />, label: "Refresh", onClick: () => void schemaQuery.mutate() }]}
        >
          <Button variant="secondary" icon={Table2} onClick={() => openTable(datasource, table)}>
            Rows
          </Button>
          <Button variant="secondary" icon={SquareTerminal} onClick={() => openQuery(datasource)}>
            Query
          </Button>
        </ViewHeader>
      }
    >
      {body}
    </ViewShell>
  );
}

function DatasourceDdl({ datasource }: { datasource: string }) {
  const { openSchema } = useDatabaseNavigation();
  const ddlQuery = useDatasourceDdl(datasource);
  const [filter, setFilter] = useState("");
  const entries = useMemo(() => {
    const all = Object.entries(ddlQuery.data?.schema ?? {});
    const needle = filter.trim().toLowerCase();
    return needle ? all.filter(([name]) => name.toLowerCase().includes(needle)) : all;
  }, [ddlQuery.data, filter]);

  let body: React.ReactNode;
  if (ddlQuery.isLoading && !ddlQuery.data) {
    body = <LoadingState message="Loading schema…" size="sm" className="py-8" />;
  } else if (ddlQuery.error && !ddlQuery.data) {
    body = <ErrorState title="Failed to load schema" error={ddlQuery.error} onRetry={() => void ddlQuery.mutate()} className="py-6" />;
  } else if (entries.length === 0) {
    body = <EmptyState icon={Columns3} title={filter ? `No tables matching "${filter}"` : "No tables"} />;
  } else {
    body = (
      <ul className="p-3 space-y-3">
        {entries.map(([name, ddl]) => (
          <li key={name} data-testid="schema-table">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex-1 min-w-0 truncate text-xs font-semibold font-mono text-primary">{name}</span>
              <Button variant="ghost" icon={Columns3} onClick={() => openSchema(datasource, name)} aria-label={`Columns of ${name}`}>
                Columns
              </Button>
            </div>
            <pre className="p-2 text-xs font-mono whitespace-pre-wrap break-all bg-secondary border border-primary rounded">{ddl}</pre>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ViewShell
      scroll
      header={
        <ViewHeader
          variant="navigator"
          title={<span className="text-sm font-semibold text-primary truncate">{datasource}</span>}
          middle={<SearchInput value={filter} onChange={setFilter} placeholder="Filter tables…" aria-label="Filter tables" />}
          actions={[{ key: "refresh", icon: <RefreshCw className="w-3 h-3" />, label: "Refresh", onClick: () => void ddlQuery.mutate() }]}
        />
      }
    >
      {body}
    </ViewShell>
  );
}
