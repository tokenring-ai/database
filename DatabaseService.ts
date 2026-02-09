import {TokenRingService} from "@tokenring-ai/app/types";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import DatabaseProvider from "./DatabaseProvider.ts";

export default class DatabaseService implements TokenRingService {
  readonly name = "DatabaseService";
  description = "Database service";
  databases = new KeyedRegistry<DatabaseProvider>();

  registerDatabase = this.databases.register;
  getDatabaseByName = this.databases.getItemByName;
  getAvailableDatabases = this.databases.getAllItemNames;

}