import type { ContextHandlerOptions, ContextItem } from "@tokenring-ai/chat/schema";
import markdownList from "@tokenring-ai/utility/string/markdownList";
import DatabaseService from "../DatabaseService.ts";
import { DatabaseState } from "../state/DatabaseState.ts";

export default function* getContextItems({ agent }: ContextHandlerOptions): Generator<ContextItem> {
  const databaseService = agent.requireService(DatabaseService);
  const available = databaseService.getDatasourceNames();
  if (available.length === 0) return;

  const { activeDatasource, activeTable } = agent.getState(DatabaseState);

  const entries = available.map(name => {
    if (name !== activeDatasource) return name;
    return activeTable ? `${name} (active — the user is currently viewing table "${activeTable}")` : `${name} (active)`;
  });

  yield {
    role: "user",
    content: `--These are the available "datasource" options that are currently configured and available for the database_* tools. They may be passed to those tools via the "datasource" field--
${markdownList(entries)}`,
  };
}
