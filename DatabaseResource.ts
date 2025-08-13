import {Registry, Resource } from "@token-ring/registry";

interface DatabaseResourceConstructorProps {
  host: string;
  port?: number;
  user: string;
  password: string;
  databaseName?: string;
}

interface DatabaseResourceStatus {
  active: boolean;
  service: string;
}

export default class DatabaseResource extends Resource {
  static constructorProperties = {
    host: {
      type: "string",
      required: true,
      description: "Database server host address",
    },
    port: {
      type: "number",
      required: false,
      description: "Database server port",
    },
    user: {
      type: "string",
      required: true,
      description: "Username for database authentication",
    },
    password: {
      type: "string",
      required: true,
      description: "Password for database authentication",
    },
    databaseName: {
      type: "string",
      required: false,
      description: "Default database name to connect to",
    },
  };

  private host: string;
  private port?: number;
  private user: string;
  private password: string;
  private databaseName?: string;

  constructor({ host, port, user, password, databaseName }: DatabaseResourceConstructorProps) {
    super();
    if (!host) {
      throw new Error("DatabaseResource requires a host.");
    }
    if (!user) {
      throw new Error("DatabaseResource requires a user.");
    }
    if (!password) {
      throw new Error("DatabaseResource requires a password.");
    }

    this.host = host;
    this.port = port;
    this.user = user;
    this.password = password;
    this.databaseName = databaseName;
  }

  /**
   * Executes an SQL query.
   * @param sqlQuery - The SQL query string.
   * @param params - Optional parameters for the query.
   * @returns The query result.
   * @throws {Error} If the method is not implemented by the subclass.
   */
  async executeSql(sqlQuery: string, params?: Record<string, any>): Promise<any> {
    throw new Error("Method 'executeSql()' must be implemented.");
  }

  /**
   * Lists all databases accessible by the connection.
   * @returns A list of database names.
   * @throws {Error} If the method is not implemented by the subclass.
   */
  async listDatabases(): Promise<string[]> {
    throw new Error("Method 'listDatabases()' must be implemented.");
  }

  /**
   * Shows the schema for all tables in a given database.
   * @param databaseName - The name of the database.
   * @returns The schema definition for all tables.
   * @throws {Error} If the method is not implemented by the subclass.
   */
  async showSchema(databaseName: string): Promise<Record<string, any> | string> {
    throw new Error("Method 'showSchema(databaseName)' must be implemented.");
  }

  getHost(): string {
    return this.host;
  }

  getPort(): number | undefined {
    return this.port;
  }

  getUser(): string {
    return this.user;
  }

  getPassword(): string {
    return this.password;
  }

  getDatabaseName(): string | undefined {
    return this.databaseName;
  }

  async start(registry: Registry): Promise<void> {
    console.log(`${this.constructor.name} starting`);
  }

  async stop(registry: Registry): Promise<void> {
    console.log(`${this.constructor.name} stopping`);
  }

  async status(registry: Registry): Promise<DatabaseResourceStatus> {
    return {
      active: true,
      service: this.constructor.name,
    };
  }
}