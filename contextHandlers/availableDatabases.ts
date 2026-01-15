import Agent from "@tokenring-ai/agent/Agent";
import {ContextItem, ParsedChatConfig} from "@tokenring-ai/chat/schema";
import DatabaseService from "../DatabaseService.ts";

export default async function* getContextItems(input: string, chatConfig: ParsedChatConfig, params: {}, agent: Agent): AsyncGenerator<ContextItem> {
  const databaseService = agent.requireServiceByType(DatabaseService);
  const available = databaseService['databases'].getAllItemNames();
  if (available.length === 0) return;

  yield {

    role: "user",
    content:
      "/* These are the databases available for the database tool */:\n" +
      available.map((name) => `- ${name}`).join("\n"),
  };
}
