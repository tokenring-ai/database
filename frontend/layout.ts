import type { AppManifest } from "@tokenring-ai/one-frontend/layout/types.ts";
import type { PluginLayoutManifest } from "@tokenring-ai/one-frontend/plugins/layoutTypes.ts";
import { Database } from "lucide-react";
import {
  DATABASE_APP_ID,
  DATABASE_APP_PATH,
  DATABASE_QUERY_VIEW_ID,
  DATABASE_SCHEMA_VIEW_ID,
  DATABASE_START_VIEW_ID,
  DATABASE_TABLE_VIEW_ID,
  DATABASE_VIEW_KIND,
  DATASOURCE_TREE_VIEW_ID,
} from "./ids.ts";

/**
 * Database: the datasource tree (with the attached database agent) on the
 * left; one tab per open table, query editor or schema on the right. Routes:
 * `/database`, `/database/<datasource>` (expands it), `/database/<datasource>/<table>`.
 */
export const DATABASE_APP: AppManifest = {
  id: DATABASE_APP_ID,
  path: DATABASE_APP_PATH,
  label: "Database",
  shortLabel: "DB",
  description: "Browse datasources and tables",
  group: "Data & tools",
  icon: Database,
  iconClass: "text-cyan-500",
  gradient: "from-cyan-500 to-sky-600",
  views: [DATASOURCE_TREE_VIEW_ID, DATABASE_START_VIEW_ID, DATABASE_TABLE_VIEW_ID, DATABASE_QUERY_VIEW_ID, DATABASE_SCHEMA_VIEW_ID, "chat"],
  primaryKind: DATABASE_VIEW_KIND,
  placement: { agent: "right" },
  layout: {
    split: "row",
    sizes: [1, 3],
    children: [
      { presenter: "single", accepts: ["navigator"], items: [DATASOURCE_TREE_VIEW_ID] },
      { presenter: "tabs", accepts: [DATABASE_VIEW_KIND], items: [DATABASE_START_VIEW_ID], primary: true },
    ],
  },
};

export default {
  apps: [DATABASE_APP],
  kinds: [{ id: DATABASE_VIEW_KIND, label: "Database views", plural: "database views" }],
} satisfies PluginLayoutManifest;
