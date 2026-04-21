import type { TokenRingService } from "@tokenring-ai/app/types";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import type DatabaseProvider from "./DatabaseProvider.ts";

export default class DatabaseService implements TokenRingService {
  readonly name = "DatabaseService";
  description = "Database service";
  databases = new KeyedRegistry<DatabaseProvider>();

  registerDatabase = this.databases.set;
  getDatabaseByName = this.databases.get;
  getAvailableDatabases = this.databases.keysArray;
}
