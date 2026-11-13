import { useRouteParamsFor } from "@tokenring-ai/one-frontend/apps/panelHooks.ts";
import EmptyState from "@tokenring-ai/one-frontend/components/ui/EmptyState.tsx";
import { Table2 } from "lucide-react";
import { DATABASE_START_VIEW_ID } from "../ids.ts";

/** The landing tab (`/database`, `/database/<datasource>`): closes itself once a table is opened. */
export default function DatabaseStartView() {
  const datasource = useRouteParamsFor(DATABASE_START_VIEW_ID)?.datasource;
  return (
    <EmptyState
      variant="page"
      icon={Table2}
      title="Select a table"
      hint={
        datasource
          ? `Browse the tables under "${datasource}" in the datasource tree to inspect their rows.`
          : "Pick a datasource in the tree, then one of its tables, to inspect its rows."
      }
    />
  );
}
