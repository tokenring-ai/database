export interface ExecuteSqlResult {
  rows: Record<string, string | number | null>[];
  fields: string[];
}

export interface DataSource {
  /**
   * Executes an SQL query.
   */
  executeSql: (_sqlQuery: string) => Promise<ExecuteSqlResult>;
  /**
   * Shows the schema for all tables in the database.
   */
  showSchema(): Promise<Record<string, string>>;

  [Symbol.asyncDispose](): Promise<void>;
}

export interface DataSourceOptions {
  url: string;
  allowWrites: boolean;
}

export type DatabaseProviderFactory = (options: DataSourceOptions) => DataSource;
