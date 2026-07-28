import type { TokenRingService } from "@tokenring-ai/app/types";
import { deepEqual } from "@tokenring-ai/one-frontend/src/lib/utils";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import type { ParsedDatabaseServiceConfig } from "./schema.ts";
import type { DatabaseProviderFactory, DataSource } from "./types.ts";

export default class DatabaseService implements TokenRingService {
  readonly name = "DatabaseService";
  description = "Database service";
  datasources = new KeyedRegistry<DataSource>();
  // A mapping from the URL scheme to the provider, ie mysql:// -> providerConstructors[mysql] => (options) => DatabaseProvider;
  factories = new KeyedRegistry<DatabaseProviderFactory>();

  registerFactory = this.factories.set;

  requireDataSource = this.datasources.require;
  getDataSource = this.datasources.get;
  getDatasourceNames = this.datasources.keysArray;

  config: ParsedDatabaseServiceConfig = {};

  reconfigure(config: ParsedDatabaseServiceConfig): void {
    this.datasources.reconcileAgainst(config, {
      creating: (_name, config) => {
        const schema = new URL(config.url).protocol;
        const factory = this.factories.get(schema);
        if (!factory) {
          throw new Error(`No provider registered for database scheme ${schema}`);
        }

        return factory(config);
      },
      deleting: (_name, datasource) => {
        void datasource[Symbol.asyncDispose]();
      },
      updating: (name, datasource, config) => {
        if (deepEqual(this.config[name], config)) return datasource;

        void datasource[Symbol.asyncDispose]();

        //TODO: A throw here causes the previous value to be kept, but it has already been disposed of.
        const schema = new URL(config.url).protocol;
        const providerConstructor = this.factories.get(schema);
        if (!providerConstructor) {
          throw new Error(`No provider registered for database scheme ${schema}`);
        }

        return providerConstructor(config);
      },
    });
  }
}
