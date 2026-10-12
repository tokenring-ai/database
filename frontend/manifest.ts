import type { ViewManifest } from "@tokenring-ai/one-frontend/dock/types.ts";
import type { PluginFrontendManifest } from "@tokenring-ai/one-frontend/plugins/types.ts";
import { Columns3, Database, SquareTerminal, Table2 } from "lucide-react";

export const DATASOURCE_TREE_VIEW = "datasource-tree";
export const DATABASE_TABLE_VIEW = "database-table";
export const DATABASE_QUERY_VIEW = "database-query";
export const DATABASE_SCHEMA_VIEW = "database-schema";

export const DATABASE_DASHBOARD_ID = "database";

/** Navigator: configured datasources, the tables of the open one, and the dashboard's agent sessions. */
export const datasourceTreeViewManifest = {
  id: DATASOURCE_TREE_VIEW,
  title: "Datasources",
  description: "Configured databases and their tables",
  icon: Database,
  availableOn: ["any"],
  defaultSize: { width: 300, height: 400 },
  minimumSize: { width: 240, height: 160 },
  tags: ["data"],
} satisfies ViewManifest;

/** One table per panel: filter bar, row grid and row detail. Without params it is a placeholder. */
export const databaseTableViewManifest = {
  id: DATABASE_TABLE_VIEW,
  title: "Table",
  description: "Browse, filter and sort the rows of one table",
  icon: Table2,
  availableOn: [],
  instanceable: true,
  // Filters, sort, paging and the row selection survive a tab switch.
  renderer: "always",
  minimumSize: { width: 360, height: 240 },
  tags: ["data"],
} satisfies ViewManifest;

/** A SQL editor bound to one datasource: run, results grid, history. Read-only unless a write is confirmed. */
export const databaseQueryViewManifest = {
  id: DATABASE_QUERY_VIEW,
  title: "Query",
  description: "Run SQL against a datasource",
  icon: SquareTerminal,
  availableOn: [],
  instanceable: true,
  // The editor and the last result survive a tab switch.
  renderer: "always",
  minimumSize: { width: 360, height: 240 },
  tags: ["data"],
} satisfies ViewManifest;

/** Columns, types and keys of one table, or the DDL of every table of a datasource. */
export const databaseSchemaViewManifest = {
  id: DATABASE_SCHEMA_VIEW,
  title: "Schema",
  description: "Columns, types and keys of a table",
  icon: Columns3,
  availableOn: [],
  instanceable: true,
  minimumSize: { width: 300, height: 200 },
  tags: ["data"],
} satisfies ViewManifest;

/** Views that act as the Database dashboard's navigator; table panels never tab into their group. */
export const DATABASE_SIDEBAR_VIEWS: readonly string[] = [DATASOURCE_TREE_VIEW];

/**
 * Metadata for the database dashboard shipped by this plugin. The frontend merges
 * this into its app registry and derives the SPA server routes from it.
 */
export default {
  id: DATABASE_DASHBOARD_ID,
  path: "/database",
  label: "Database",
  shortLabel: "DB",
  description: "Browse datasources and tables",
  group: "Data & tools",
  icon: Database,
  iconClass: "text-cyan-500",
  gradient: "from-cyan-500 to-sky-600",
  views: [datasourceTreeViewManifest, databaseTableViewManifest, databaseQueryViewManifest, databaseSchemaViewManifest],
} satisfies PluginFrontendManifest;
