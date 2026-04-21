import type { ContextHandlerOptions, ContextItem } from "@tokenring-ai/chat/schema";
import DatabaseService from "../DatabaseService.ts";

export default function* getContextItems({ agent }: ContextHandlerOptions): Generator<ContextItem> {
  const databaseService = agent.requireServiceByType(DatabaseService);
  const available = databaseService.getAvailableDatabases();
  if (available.length === 0) return;

  yield {
    role: "user",
    content: "/* These are the databases available for the database tool */:\n" + available.map(name => `- ${name}`).join("\n"),
  };
}
