# @tokenring-ai/database

## Overview

The `@tokenring-ai/database` package provides an abstract layer for managing database resources within TokenRing AI agents. It enables the registration and interaction with multiple database connections through a unified `DatabaseService`. This service integrates with the TokenRing agent framework, allowing AI agents to perform database operations like executing SQL queries and inspecting schemas.

The package focuses on abstraction, requiring implementers to extend `DatabaseProvider` for specific database types (e.g., PostgreSQL, MySQL). It supports read-only and read-write operations, with tools for safe querying and schema exploration. This is particularly useful for AI-driven applications that need to interact with databases dynamically.

## Installation

```bash
npm install @tokenring-ai/database
```

## Package Structure

```
pkg/database/
├── index.ts                 # Package entry point and plugin definition
├── DatabaseService.ts       # Core service for managing database providers
├── DatabaseProvider.ts      # Abstract base class for database implementations
├── tools.ts                 # Re-exports of agent tools
├── tools/
│   ├── executeSql.ts        # Tool for executing SQL queries
│   └── showSchema.ts        # Tool for retrieving database schemas
├── package.json             # Package metadata and dependencies
└── README.md                # This documentation
```

## Core Components

### DatabaseService

The `DatabaseService` is the central manager for database providers, implementing the `TokenRingService` interface. It handles registration and retrieval of database providers.

**Key Methods:**
- `registerDatabase(name: string, provider: DatabaseProvider)`: Registers a database provider by name
- `getDatabaseByName(name: string): DatabaseProvider`: Retrieves a registered provider
- `getAvailableDatabases(): string[]`: Lists all registered database names
- `async* getContextItems(agent: Agent): AsyncGenerator<ContextItem>`: Yields context about available databases for agent awareness

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

### Tools

The package provides two agent tools that integrate with the TokenRing chat system:

#### executeSql
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
  - Supports both read and write operations (when allowed)

#### showSchema
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

## Usage Examples

### 1. Implementing a Concrete DatabaseProvider

```typescript
import DatabaseProvider from './DatabaseProvider';
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

The package exports a TokenRing plugin that automatically integrates with the application:

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

## Plugin Configuration

The plugin can be configured in your TokenRing app configuration:

```typescript
interface DatabaseConfig {
  providers?: Record<string, any>;
}
```

## Dependencies

- `@tokenring-ai/agent` (v0.1.0): Core agent framework
- `@tokenring-ai/utility` (v0.1.0): Utility functions including KeyedRegistry
- `zod`: Schema validation for tool inputs

## Development

```bash
# Run ESLint
npm run eslint
```

## License

See LICENSE file for details.