import {Agent} from "@tokenring-ai/agent";
import {MemoryItemMessage, TokenRingService} from "@tokenring-ai/agent/types";
import DatabaseResource from "./DatabaseResource.ts";

export default class DatabaseService implements TokenRingService {
  name = "DatabaseService";
  description = "Database service";
  private resources: Record<string, DatabaseResource> = {};
  private activeResources: Set<string> = new Set();

  registerResource(name: string, resource: DatabaseResource) {
    this.resources[name] = resource;
  }

  getActiveResourceNames(): Set<string> {
    return this.activeResources;
  }

  enableResources(...names: string[]): void {
    for (const name of names) {
      if (!this.resources[name]) {
        throw new Error(`FileMatchResource resource ${name} not found`);
      }
      this.activeResources.add(name);
    }
  }

  getResourceByName(name: string): DatabaseResource {
    if (!this.activeResources.has(name)) throw new Error(`Resource ${name} not enabled`);
    return this.resources[name];
  }

  getAvailableResources(): string[] {
    return Object.keys(this.resources);
  }

  /**
   * Asynchronously yields memories from file tree and whole files
   */
  async* getMemories(agent: Agent): AsyncGenerator<MemoryItemMessage> {
    yield {
      role: "user",
      content: "These are the databases available for the database tools:\n" +
        Object.keys(this.resources).join(", "),
    }
  }

  private getActiveResources(): Record<string, DatabaseResource> {
    const ret: Record<string, DatabaseResource> = {};
    for (const name of this.activeResources) {
      ret[name] = this.resources[name];
    }
    return ret;
  }
}