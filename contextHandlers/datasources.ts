import type { ContextHandlerOptions, ContextItem } from "@tokenring-ai/chat/schema";
import markdownList from "@tokenring-ai/utility/string/markdownList";
import DatabaseService from "../DatabaseService.ts";

export default function* getContextItems({ agent }: ContextHandlerOptions): Generator<ContextItem> {
  const databaseService = agent.requireServiceByType(DatabaseService);
  const available = databaseService.getDatasourceNames();
  if (available.length === 0) return;

  yield {
    role: "user",
    content: `--These are the available "datasource" options that are currently configured and available for the database_* tools. They may be passed to those tools via the "datasource" field--
${markdownList(available)}`,
  };
}
