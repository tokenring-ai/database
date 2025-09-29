export interface DatabaseProviderOptions {
  allowWrites?: boolean;
}

export interface ExecuteSqlResult {
  rows: Record<string, string | number | null>[];
  fields: string[];
}

export default class DatabaseProvider {
  allowWrites: boolean;

  constructor({allowWrites}: DatabaseProviderOptions) {
    this.allowWrites = allowWrites ?? false;
  }

  /**
   * Executes an SQL query.
   */
  async executeSql(_sqlQuery: string): Promise<ExecuteSqlResult> {
    throw new Error("Method 'executeSql()' must be implemented.");
  }

  /**
   * Shows the schema for all tables in a given database.
   */
  async showSchema(): Promise<Record<string, string>> {
    throw new Error("Method 'showSchema(databaseName)' must be implemented.");
  }
}