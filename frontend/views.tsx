import { defineView } from "@tokenring-ai/one-frontend/layout/define.ts";
import type { PluginLayoutViews } from "@tokenring-ai/one-frontend/plugins/layoutTypes.ts";
import { Columns3, Database, SquareTerminal, Table2 } from "lucide-react";
import { lazy } from "react";
import {
  DATABASE_QUERY_VIEW_ID,
  DATABASE_SCHEMA_VIEW_ID,
  DATABASE_START_VIEW_ID,
  DATABASE_TABLE_VIEW_ID,
  DATABASE_VIEW_KIND,
  DATASOURCE_TREE_VIEW_ID,
} from "./ids.ts";
import { databaseQueryInstanceKey, databaseSchemaInstanceKey, databaseTableInstanceKey } from "./lib/instanceKeys.ts";

const DatasourceTreePane = lazy(() => import("./panes/DatasourceTreePane.tsx"));
const DatabaseStartView = lazy(() => import("./panes/DatabaseStartView.tsx"));
const DatabaseTablePane = lazy(() => import("./panes/DatabaseTablePane.tsx"));
const DatabaseQueryPane = lazy(() => import("./panes/DatabaseQueryPane.tsx"));
const DatabaseSchemaPane = lazy(() => import("./panes/DatabaseSchemaPane.tsx"));

export default {
  views: [
    defineView({
      id: DATASOURCE_TREE_VIEW_ID,
      kind: "navigator",
      title: "Datasources",
      description: "Configured databases and their tables",
      icon: Database,
      closable: false,
      component: DatasourceTreePane,
    }),
    // `/database` (or `/database/<datasource>`): the "Select a table" landing tab; closes once a table is opened.
    defineView({
      id: DATABASE_START_VIEW_ID,
      landing: true,
      kind: DATABASE_VIEW_KIND,
      title: "Select a table",
      description: "Pick a datasource and a table to inspect its rows",
      icon: Table2,
      route: ":datasource?",
      instanceKey: () => "",
      component: DatabaseStartView,
    }),
    // One table per panel: filter bar, row grid and row detail.
    defineView({
      id: DATABASE_TABLE_VIEW_ID,
      kind: DATABASE_VIEW_KIND,
      title: params => params.table ?? "Table",
      description: "Browse, filter and sort the rows of one table",
      icon: Table2,
      route: ":datasource/:table",
      instanceKey: databaseTableInstanceKey,
      component: DatabaseTablePane,
    }),
    // A SQL editor per datasource. The engine shows the URL's panel over its siblings, so it needs a URL: `/database/<ds>/-/query`
    // (three segments, so it can never collide with an old `/database/<ds>/<table>` URL).
    defineView({
      id: DATABASE_QUERY_VIEW_ID,
      kind: DATABASE_VIEW_KIND,
      title: params => `Query · ${params.datasource ?? ""}`,
      description: "Run SQL against a datasource",
      icon: SquareTerminal,
      route: ":datasource/-/query",
      instanceKey: databaseQueryInstanceKey,
      component: DatabaseQueryPane,
    }),
    // Columns of one table, or the DDL of a whole datasource: `/database/<ds>/-/schema[/<table>]`.
    defineView({
      id: DATABASE_SCHEMA_VIEW_ID,
      kind: DATABASE_VIEW_KIND,
      title: params => (params.table ? `${params.table} columns` : `Schema · ${params.datasource ?? ""}`),
      description: "Columns, types and keys of a table",
      icon: Columns3,
      route: ":datasource/-/schema/:table?",
      instanceKey: databaseSchemaInstanceKey,
      component: DatabaseSchemaPane,
    }),
  ],
} satisfies PluginLayoutViews;
