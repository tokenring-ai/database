import {Agent} from "@tokenring-ai/agent";
import {ContextItem, TokenRingService} from "@tokenring-ai/agent/types";
import KeyedRegistry from "@tokenring-ai/utility/KeyedRegistry";
import DatabaseResource from "./DatabaseResource.ts";

export default class DatabaseService implements TokenRingService {
  name = "DatabaseService";
  description = "Database service";
  private databases = new KeyedRegistry<DatabaseResource>();

  registerDatabase = this.databases.register;
  getDatabaseByName = this.databases.getItemByName;
  getAvailableDatabases = this.databases.getAllItemNames;

  /**
   * Asynchronously yields memories from file tree and whole files
   */
  async* getContextItems(agent: Agent): AsyncGenerator<ContextItem> {
    const available = this.databases.getAllItemNames();
    if (available.length === 0) return;

    yield {
      position: "afterSystemMessage",
      role: "user",
      content:
        "/* These are the databases available for the database tool */:\n" +
        available.map((name) => `- ${name}`).join("\n"),
    };
  }
}