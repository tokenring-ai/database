import {Resource} from "@token-ring/registry";

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

  private readonly host: string;
  private readonly port?: number;
  private readonly user: string;
  private readonly password: string;
  private readonly databaseName?: string;

  constructor({host, port, user, password, databaseName}: DatabaseResourceConstructorProps) {
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
   */
  async executeSql(sqlQuery: string, params?: Record<string, any>): Promise<any> {
    throw new Error("Method 'executeSql()' must be implemented.");
  }

  /**
   * Lists all databases accessible by the connection.
   */
  async listDatabases(): Promise<string[]> {
    throw new Error("Method 'listDatabases()' must be implemented.");
  }

  /**
   * Shows the schema for all tables in a given database.
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
}