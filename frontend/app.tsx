import { openInMainArea } from "@tokenring-ai/one-frontend/dock/layout/mainArea.ts";
import type { PluginFrontendContribution } from "@tokenring-ai/one-frontend/plugins/types.ts";
import { lazy } from "react";
import { z } from "zod";
import { databasePath } from "./lib/paths.ts";
import manifest, {
  DATABASE_QUERY_VIEW,
  DATABASE_SCHEMA_VIEW,
  DATABASE_SIDEBAR_VIEWS,
  DATABASE_TABLE_VIEW,
  databaseQueryViewManifest,
  databaseSchemaViewManifest,
  databaseTableViewManifest,
  datasourceTreeViewManifest,
} from "./manifest.ts";

export const DatabaseTableParams = z.object({
  /** Omitted for the placeholder panel that the next opened table fills. */
  datasource: z.string().min(1).optional(),
  table: z.string().min(1).optional(),
});
export type DatabaseTableParams = z.infer<typeof DatabaseTableParams>;

/**
 * One panel per datasource + table pair; a parameter-less panel is the shared
 * placeholder. Each part is URI-encoded so a `/` inside a name cannot make two
 * pairs share a key (`a/b` + `c` vs `a` + `b/c`), and the key always holds a
 * literal `/`, so it never equals the placeholder's "new".
 */
export function databaseTableInstanceKey(params: DatabaseTableParams): string {
  return params.datasource && params.table ? `${encodeURIComponent(params.datasource)}/${encodeURIComponent(params.table)}` : "new";
}

export const DatabaseQueryParams = z.object({
  datasource: z.string().min(1),
});
export type DatabaseQueryParams = z.infer<typeof DatabaseQueryParams>;

/** One query editor per datasource. */
export function databaseQueryInstanceKey(params: DatabaseQueryParams): string {
  return encodeURIComponent(params.datasource);
}

export const DatabaseSchemaParams = z.object({
  datasource: z.string().min(1),
  /** Omitted for the whole datasource's DDL. */
  table: z.string().min(1).optional(),
});
export type DatabaseSchemaParams = z.infer<typeof DatabaseSchemaParams>;

/** One schema panel per table, plus one per datasource for its full DDL; encoded like the table key. */
export function databaseSchemaInstanceKey(params: DatabaseSchemaParams): string {
  const datasource = encodeURIComponent(params.datasource);
  return params.table ? `${datasource}/${encodeURIComponent(params.table)}` : datasource;
}

/**
 * The Database dashboard: the datasource tree beside one panel per open table.
 * `/database/<datasource>` expands a datasource, `/database/<datasource>/<table>`
 * opens (or focuses) that table; the active table keeps the URL in step.
 * Discovered by `frontend/src/plugins/registry.ts`.
 */
export default {
  ...manifest,
  views: [
    { ...datasourceTreeViewManifest, component: lazy(() => import("./views/DatasourceTreeView.tsx")) },
    {
      ...databaseTableViewManifest,
      params: DatabaseTableParams,
      instanceKey: databaseTableInstanceKey,
      titleFor: params => params.table ?? "Select a table",
      component: lazy(() => import("./views/DatabaseTableView.tsx")),
    },
    {
      ...databaseQueryViewManifest,
      params: DatabaseQueryParams,
      instanceKey: databaseQueryInstanceKey,
      titleFor: params => `Query · ${params.datasource}`,
      component: lazy(() => import("./views/DatabaseQueryView.tsx")),
    },
    {
      ...databaseSchemaViewManifest,
      params: DatabaseSchemaParams,
      instanceKey: databaseSchemaInstanceKey,
      titleFor: params => (params.table ? `${params.table} columns` : `Schema · ${params.datasource}`),
      component: lazy(() => import("./views/DatabaseSchemaView.tsx")),
    },
  ],
  dashboards: [
    {
      ...manifest,
      routePath: "/database/:datasource?/:table?",
      defaultLayout: {
        kind: "row",
        sizes: [1, 3],
        children: [
          { kind: "panel", view: datasourceTreeViewManifest.id },
          { kind: "panel", view: databaseTableViewManifest.id },
        ],
      },
      onNavigate({ params }, api) {
        const { datasource, table } = params;
        // A datasource on its own only expands the tree; a table gets a panel.
        if (!datasource || !table) return;
        openInMainArea(api, DATABASE_TABLE_VIEW, { datasource, table }, { sidebarViews: DATABASE_SIDEBAR_VIEWS, fillPlaceholder: true });
      },
      pathForActivePanel(panel, match) {
        // Query and schema panels point the URL at their datasource only: a
        // `/database/<ds>/<table>` URL would open that table's row panel.
        if (panel?.viewId === DATABASE_QUERY_VIEW || panel?.viewId === DATABASE_SCHEMA_VIEW) {
          return typeof panel.params.datasource === "string" ? databasePath(panel.params.datasource) : null;
        }
        if (panel?.viewId !== DATABASE_TABLE_VIEW) return null;
        const datasource = typeof panel.params.datasource === "string" ? panel.params.datasource : null;
        const table = typeof panel.params.table === "string" ? panel.params.table : null;
        // The empty placeholder must not wipe the datasource the tree is showing.
        if (!datasource || !table) return match.params.datasource ? databasePath(match.params.datasource) : null;
        return databasePath(datasource, table);
      },
      documentTitle: ({ params }) => {
        if (params.table) return `${params.table} · Database`;
        return params.datasource ? `${params.datasource} · Database` : "Database";
      },
    },
  ],
} satisfies PluginFrontendContribution;
