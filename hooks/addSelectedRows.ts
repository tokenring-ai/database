import { AfterInputReceived } from "@tokenring-ai/agent";
import type Agent from "@tokenring-ai/agent/Agent";
import type { HookSubscription } from "@tokenring-ai/lifecycle/types";
import { HookCallback } from "@tokenring-ai/lifecycle/util/hooks";
import { DatabaseState } from "../state/DatabaseState.ts";
import type { Row, TableSchema } from "../types.ts";

const name = "addSelectedRows";
const displayName = "Database/Add selected rows to chat";
const description = "Attaches the active table's schema and the currently selected rows to the chat message";

/** Rows are capped so a wide selection can't crowd out the rest of the context. */
const MAX_ATTACHED_ROWS = 100;
const MAX_ATTACHED_BYTES = 256 * 1024;

/** Cheap content fingerprint, so re-selecting the same rows doesn't re-attach them. */
function fingerprintRows(rows: Row[]): string {
  let hash = 0;
  const serialized = JSON.stringify(rows);
  for (let i = 0; i < serialized.length; i++) {
    hash = (Math.imul(hash, 31) + serialized.charCodeAt(i)) | 0;
  }
  return `${rows.length}:${hash.toString(36)}`;
}

function schemaToMarkdown(schema: TableSchema): string {
  const header = "| Column | Type | Nullable | Key | Default |\n| --- | --- | --- | --- | --- |";
  const rows = schema.columns
    .map(
      column =>
        `| ${column.name} | ${column.dataType} | ${column.nullable ? "yes" : "no"} | ${column.isPrimaryKey ? "PK" : ""} | ${column.defaultValue ?? ""} |`,
    )
    .join("\n");
  const ddl = schema.ddl ? `\n\n\`\`\`sql\n${schema.ddl}\n\`\`\`` : "";
  return `### ${schema.table.name} (${schema.table.type})\n\n${header}\n${rows}${ddl}`;
}

async function addSelectedRows(data: AfterInputReceived, agent: Agent) {
  const attachments = (data.input.attachments ??= []);

  agent.mutateState(DatabaseState, state => {
    const { activeDatasource, activeTable, activeTableSchema } = state;
    if (!activeDatasource || !activeTable) return;

    const schemaKey = `${activeDatasource}:${activeTable}`;
    if (activeTableSchema && state.lastAttachedSchemaKey !== schemaKey) {
      state.lastAttachedSchemaKey = schemaKey;
      attachments.push({
        name: `Schema: ${activeTable}`,
        description: `Schema of the table currently open in the Database app, on datasource "${activeDatasource}".`,
        encoding: "text",
        mimeType: "text/markdown",
        body: schemaToMarkdown(activeTableSchema),
      });
    }

    if (state.selectedRows.length === 0) return;

    const selectionKey = `${schemaKey}:${fingerprintRows(state.selectedRows)}`;
    if (state.lastAttachedSelectionKey === selectionKey) return;
    state.lastAttachedSelectionKey = selectionKey;

    let rows = state.selectedRows;
    let truncated = rows.length > MAX_ATTACHED_ROWS;
    if (truncated) rows = rows.slice(0, MAX_ATTACHED_ROWS);

    let body = JSON.stringify(rows, null, 2);
    while (body.length > MAX_ATTACHED_BYTES && rows.length > 1) {
      rows = rows.slice(0, Math.floor(rows.length / 2));
      truncated = true;
      body = JSON.stringify(rows, null, 2);
    }

    const total = state.selectedRows.length;
    attachments.push({
      name: `${total} selected row${total === 1 ? "" : "s"} from ${activeTable}`,
      description: truncated
        ? `The rows below are the user's current selection from "${activeTable}" on datasource "${activeDatasource}", truncated to the first ${rows.length} of ${total} rows.`
        : `The rows below are the user's current selection from "${activeTable}" on datasource "${activeDatasource}".`,
      encoding: "text",
      mimeType: "application/json",
      body,
    });
  });
}

const callbacks = [new HookCallback(AfterInputReceived, addSelectedRows)];

export default {
  name,
  displayName,
  description,
  callbacks,
} satisfies HookSubscription;
