import { Database } from "lucide-react";
import type { PluginAppManifest } from "@tokenring-ai/one-frontend/plugins/types.ts";

/**
 * Metadata for the database app shipped by this plugin. The frontend merges
 * this into its app registry and derives the SPA server routes from it.
 */
export default {
  id: "database",
  path: "/database",
  label: "Database",
  shortLabel: "DB",
  description: "Browse datasources and tables",
  group: "Data & tools",
  icon: Database,
  iconClass: "text-cyan-500",
  gradient: "from-cyan-500 to-sky-600",
} satisfies PluginAppManifest;
