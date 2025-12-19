# @tokenring-ai/database

## Overview

The `@tokenring-ai/database` package provides an abstract database layer for managing database resources within TokenRing AI agents. It enables the registration and interaction with multiple database connections through a unified `DatabaseService` that integrates with the TokenRing agent framework.

The package focuses on abstraction, requiring implementers to extend `DatabaseProvider` for specific database types (e.g., PostgreSQL, MySQL). It supports read-only and read-write operations, with tools for safe querying and schema exploration, making it particularly useful for AI-driven applications that need to interact with databases dynamically.

## Installation

```bash
npm install @tokenring-ai/database
```

## Package Structure

```
pkg/database/
├── index.ts                          # Package entry point and configuration schema
├── DatabaseService.ts                # Core service for managing database providers
├── DatabaseProvider.ts               # Abstract base class for database implementations
├── plugin.ts                         # TokenRing plugin integration
├── tools.ts                          # Tool exports
├── tools/
│   ├── executeSql.ts                 # SQL execution tool
│   └── showSchema.ts                 # Schema inspection tool
├── contextHandlers.ts                # Context handler exports
├── contextHandlers/
│   └── availableDatabases.ts         # Database availability context handler
└── package.json                      # Package metadata and dependencies
```

## Core Components

### DatabaseService

The `DatabaseService` is the central manager for database providers, implementing the `TokenRingService` interface. It uses a `KeyedRegistry` for managing registered database providers.

**Key Methods:**
- `registerDatabase(name: string, provider: DatabaseProvider)`: Registers a database provider by name
- `getDatabaseByName(name: string): DatabaseProvider`: Retrieves a registered provider
- `getAvailableDatabases(): string[]`: Lists all registered database names

### DatabaseProvider

Abstract base class for concrete database implementations. Extend this to connect to specific databases.

**Constructor Options:**
```typescript
interface DatabaseProviderOptions {
  allowWrites?: boolean;  // Defaults to false
}
```

**Abstract Methods (must be implemented):**
- `async executeSql(sqlQuery: string): Promise<ExecuteSqlResult>`: Executes SQL and returns structured results
- `async showSchema(): Promise<Record<string, string>>`: Returns table schemas as key-value map

**Interfaces:**
```typescript
interface ExecuteSqlResult {
  rows: Record<string, string | number | null>[];
  fields: string[];
}
```

## Tools

The package provides two agent tools that integrate with the TokenRing chat system:

### executeSql
- **Name**: `database/executeSql`
- **Description**: Executes an arbitrary SQL query on a database
- **Input Schema**:
  ```typescript
  {
    databaseName?: string,  // Optional: The name of the database to target
    sqlQuery: string        // The SQL query to execute
  }
  ```
- **Features**:
  - Automatically prompts for human confirmation on non-SELECT queries
  - Validates database existence before execution
  - Requires `available-databases` context handler
  - Provides detailed error messages for missing databases

### showSchema
- **Name**: `database/showSchema`
- **Description**: Shows the 'CREATE TABLE' statements for all tables in the specified database
- **Input Schema**:
  ```typescript
  {
    databaseName: string  // Required: The name of the database
  }
  ```
- **Features**:
  - Validates database existence
  - Returns structured schema information
  - Requires `available-databases` context handler

## Context Handlers

### available-databases
Automatically provides agents with information about available databases through the context system.

**Functionality:**
- Yields database names as context items
- Returns empty if no databases are registered
- Provides formatted list of available databases for agent awareness

## Plugin Integration

The package exports a TokenRing plugin that automatically integrates with the application:

```typescript
export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app: TokenRingApp) {
    const config = app.getConfigSlice('database', DatabaseConfigSchema);
    if (config) {
      app.waitForService(ChatService, chatService => {
        chatService.addTools(packageJSON.name, tools);
        chatService.registerContextHandlers(contextHandlers);
      });
      app.addServices(new DatabaseService());
    }
  }
}
```

## Configuration

### DatabaseConfig Schema
```typescript
interface DatabaseConfig {
  providers?: Record<string, any>;
}
```

The configuration is validated using Zod schema:
```typescript
export const DatabaseConfigSchema = z.object({
  providers: z.record(z.string(), z.any())
}).optional();
```

### Example Configuration
```typescript
const app = new TokenRingApp({
  config: {
    database: {
      providers: {
        myPostgres: {
          allowWrites: true,
          connectionString: process.env.DB_URL
        },
        myReadonlyDb: {
          allowWrites: false,
          connectionString: process.env.READONLY_DB_URL
        }
      }
    }
  }
});
```

## Usage Examples

### 1. Implementing a Concrete DatabaseProvider

```typescript
import DatabaseProvider from '@tokenring-ai/database';
import { Pool } from 'pg';

export class PostgresProvider extends DatabaseProvider {
  private pool: Pool;

  constructor(options: DatabaseProviderOptions & { connectionString: string }) {
    super(options);
    this.pool = new Pool({ connectionString: options.connectionString });
  }

  async executeSql(sqlQuery: string): Promise<ExecuteSqlResult> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sqlQuery);
      return {
        rows: result.rows,
        fields: result.fields.map(f => f.name)
      };
    } finally {
      client.release();
    }
  }

  async showSchema(): Promise<Record<string, string>> {
    const client = await this.pool.connect();
    try {
      const res = await client.query(`
        SELECT table_name, pg_get_tabledef(table_name::regclass) as schema 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      
      const schemas: Record<string, string> = {};
      for (const row of res.rows) {
        schemas[row.table_name] = row.schema;
      }
      return schemas;
    } finally {
      client.release();
    }
  }
}
```

### 2. Using with TokenRing Plugin

```typescript
import TokenRingApp from '@tokenring-ai/app';
import databasePlugin from '@tokenring-ai/database';

const app = new TokenRingApp({
  config: {
    database: {
      providers: {
        myPostgres: {
          allowWrites: true,
          connectionString: process.env.DB_URL
        }
      }
    }
  }
});

app.use(databasePlugin);
```

### 3. Direct Usage

```typescript
import DatabaseService from '@tokenring-ai/database/DatabaseService';
import PostgresProvider from './PostgresProvider';

const dbService = new DatabaseService();
const postgresDb = new PostgresProvider({
  allowWrites: true,
  connectionString: process.env.DB_URL
});

dbService.registerDatabase('myPostgres', postgresDb);

// Now available to agents through the tools
```

### 4. Using with MySQL

```typescript
import DatabaseProvider from '@tokenring-ai/database';
import mysql from 'mysql2/promise';

export class MySQLProvider extends DatabaseProvider {
  private connection: mysql.Connection;

  constructor(options: DatabaseProviderOptions & { connection: mysql.Connection }) {
    super(options);
    this.connection = options.connection;
  }

  async executeSql(sqlQuery: string): Promise<ExecuteSqlResult> {
    const [rows, fields] = await this.connection.execute(sqlQuery);
    return {
      rows: rows as Record<string, string | number | null>[],
      fields: fields.map(f => f.name)
    };
  }

  async showSchema(): Promise<Record<string, string>> {
    const [rows] = await this.connection.execute('SHOW CREATE TABLE');
    // Process results and return as Record<string, string>
  }
}
```

## Agent Integration

### Context Provision
Agents automatically receive context about available databases through the `available-databases` context handler:

```
/* These are the databases available for the database tool */:
- myPostgres
- myReadonlyDb
- analytics
```

### Tool Usage in Agents
Agents can use the database tools directly:

```typescript
// Execute a SELECT query
await agent.callTool('database/executeSql', {
  databaseName: 'myPostgres',
  sqlQuery: 'SELECT * FROM users WHERE active = true'
});

// Show schema
await agent.callTool('database/showSchema', {
  databaseName: 'myPostgres'
});
```

## Security Features

### Write Operation Protection
The `executeSql` tool includes automatic protection for non-SELECT queries:

```typescript
if (!sqlQuery.trim().startsWith("SELECT")) {
  const approved = await agent.askHuman({
    type: "askForConfirmation",
    message: `Execute SQL write operation on database '${databaseName}'?\n\nQuery: ${sqlQuery}`,
  });

  if (!approved) {
    throw new Error("User did not approve the SQL query that was provided.");
  }
}
```

### Database Validation
Both tools validate that the specified database exists before execution:
```typescript
const databaseResource = databaseService.getDatabaseByName(databaseName);
if (!databaseResource) {
  throw new Error(`[${name}] Database ${databaseName} not found`);
}
```

## Dependencies

- `@tokenring-ai/app` (v0.2.0): Core application framework and TokenRingService interface
- `@tokenring-ai/chat` (v0.2.0): Chat service and tool definitions
- `@tokenring-ai/agent` (v0.2.0): Agent framework and types
- `@tokenring-ai/utility` (v0.2.0): KeyedRegistry implementation
- `zod`: Schema validation for configuration and tool inputs

## Development

```bash
# Run ESLint
npm run eslint
```

## Error Handling

The package provides comprehensive error handling:

- **Missing Database**: Clear error messages when database not found
- **Invalid Parameters**: Zod validation for all tool inputs
- **Write Confirmation**: Human approval required for non-SELECT queries
- **Provider Errors**: Propagates errors from underlying database implementations

## License

See LICENSE file for details.