export interface DatabaseProviderOptions {
  allowWrites?: boolean;
}

export interface ExecuteSqlResult {
  rows: Record<string, string | number | null>[];
  fields: string[];
}

export default class DatabaseProvider {
  constructor(private allowWrites: boolean = false) {
  }

  /**
   * Executes an SQL query.
   */
  executeSql(_sqlQuery: string): Promise<ExecuteSqlResult> {
    throw new Error("Method 'executeSql()' must be implemented.");
  }

  /**
   * Shows the schema for all tables in the database.
   */
  showSchema(): Promise<Record<string, string>> {
    throw new Error("Method 'showSchema()' must be implemented.");
  }
}
