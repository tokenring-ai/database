import manifest from "./manifest.ts";
import DatabaseApp from "./DatabaseApp.tsx";
import type { PluginAppDefinition } from "@tokenring-ai/one-frontend/plugins/types.ts";

/**
 * The database app contributed to the TokenRing One frontend by this
 * plugin. Discovered by `frontend/src/plugins/registry.ts`.
 */
export default {
  ...manifest,
  routePath: "/database/:datasource?",
  component: DatabaseApp,
} satisfies PluginAppDefinition;
