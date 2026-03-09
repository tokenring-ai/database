# @tokenring-ai/database

## Overview

The `@tokenring-ai/database` package provides an abstract database layer for managing database resources within TokenRing AI agents. It enables the registration and interaction with multiple database connections through a unified `DatabaseService` that integrates with the TokenRing plugin system and agent framework.

The package focuses on abstraction, requiring implementers to extend `DatabaseProvider` for specific database types. It supports tool-based interaction with agents, context handlers for database availability, and write operation protection through human confirmation for non-SELECT queries.

## Key Features

- Abstract database provider interface for multiple database systems
- Unified service management through `DatabaseService` with KeyedRegistry pattern
- Tool-based interaction with agents via ChatService
- Context handlers for database availability injection
- Write protection with human confirmation for non-SELECT queries
- Schema inspection capabilities
- Type-safe tool execution with Zod schemas
- Required context handler enforcement (`available-databases`)

## Installation

```bash
bun add @tokenring-ai/database
```

## Core Components/API

### DatabaseService

The main service class that implements `TokenRingService` interface. It manages a registry of `DatabaseProvider` instances using the `KeyedRegistry` from `@tokenring-ai/utility`.

**Service Properties:**

- `name: string` - Service identifier ("DatabaseService")
- `description: string` - Service description ("Database service")
- `databases: KeyedRegistry<DatabaseProvider>` - Registry managing all database provider instances

**Resource Management Methods:**

```typescript
registerDatabase = this.databases.register
getDatabaseByName = this.databases.getItemByName
getAvailableDatabases = this.databases.getAllItemNames
```

These methods are exposed as arrow functions that delegate to the underlying `KeyedRegistry` instance.

### DatabaseProvider

Abstract base class for concrete database implementations. All database provider implementations must extend this class and implement the required methods.

**Constructor:**

```typescript
constructor(allowWrites: boolean = false)
```

**Properties:**

- `allowWrites: boolean` - Whether write operations are allowed on this provider (defaults to false)

**Abstract Methods (must be implemented):**

```typescript
async executeSql(sqlQuery: string): Promise<ExecuteSqlResult>

async showSchema(): Promise<Record<string, string>>
```

**Result Interface:**

```typescript
export interface ExecuteSqlResult {
  rows: Record<string, string | number | null>[];
  fields: string[];
}
```

### Tools

#### database_executeSql

Executes an arbitrary SQL query on a database. WARNING: Use with extreme caution as this can modify or delete data.

**Input Schema:**

```typescript
z.object({
  databaseName: z.string().optional()
    .describe("Optional: The name of the database to target. May also be specified in the SQL query."),
  sqlQuery: z.string().describe("The SQL query to execute.")
})
```

**Required Context Handlers:** `["available-databases"]`

**Behavior:**
- If the query does not start with "SELECT", the agent will request human approval before execution
- If the user does not approve, a `CommandFailedError` is thrown with the message "User did not approve the SQL query that was provided."
- If the database is not found, an error is thrown with the message `[database_executeSql] Database <databaseName> not found`

#### database_showSchema

Shows the `'CREATE TABLE'` statements (or equivalent) for all tables in the specified database.

**Input Schema:**

```typescript
z.object({
  databaseName: z.string()
    .describe("The name of the database for which to show the schema.")
})
```

**Required Context Handlers:** `["available-databases"]`

**Behavior:**
- If the database is not found, an error is thrown with the message `[database_showSchema] Database <databaseName> not found`

### Context Handlers

#### available-databases

Automatically provides agents with information about available databases.

**Context Item Format:**

```
/* These are the databases available for the database tool */:
- postgresql
- mysql
- sqlite
```

**Implementation Details:**
- The context handler retrieves all registered database names from the `DatabaseService`
- If no databases are registered, no context item is yielded
- The context handler is automatically registered when the plugin is installed with a database configuration

## Usage Examples

### 1. Implementing a Concrete DatabaseProvider

```typescript
import DatabaseProvider, { ExecuteSqlResult } from '@tokenring-ai/database';
import { Pool } from 'pg';

export class PostgresProvider extends DatabaseProvider {
  private pool: Pool;

  constructor(connectionString: string, allowWrites: boolean = false) {
    super(allowWrites);
    this.pool = new Pool({ connectionString });
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

### 2. Using Direct Service API

```typescript
import DatabaseService from '@tokenring-ai/database/DatabaseService';
import PostgresProvider from './PostgresProvider';

// Create the service
const dbService = new DatabaseService();

// Register a database provider
const postgresDb = new PostgresProvider(
  process.env.DB_URL,
  true  // allowWrites
);

dbService.registerDatabase('myPostgres', postgresDb);

// List available databases
const available = dbService.getAvailableDatabases();
console.log('Available databases:', available);
// Output: ['myPostgres']

// Get specific database
const postgresResource = dbService.getDatabaseByName('myPostgres');
if (postgresResource) {
  const schema = await postgresResource.showSchema();
  console.log('Schema:', schema);
}
```

### 3. Plugin Installation

```typescript
import TokenRingApp from "@tokenring-ai/app";
import databasePlugin from "@tokenring-ai/database";

const app = new TokenRingApp();

app.install(databasePlugin, {
  database: {
    providers: {
      myPostgres: {},
      myReadonlyDb: {}
    }
  }
});

// Service, tools, and context handlers are now available
```

### 4. Using Tools in Agents

```typescript
import { Agent } from "@tokenring-ai/agent";
import { DatabaseService } from "@tokenring-ai/database";

const agent = new Agent();

// Services are available through agent dependency injection
const databaseService = agent.requireServiceByType(DatabaseService);

// List available databases
const available = databaseService.getAvailableDatabases();
console.log('Available databases:', available);

// Show schema
const schema = await agent.callTool('database_showSchema', {
  databaseName: 'myPostgres'
});

// Execute SELECT query
const result = await agent.callTool('database_executeSql', {
  databaseName: 'myPostgres',
  sqlQuery: 'SELECT * FROM users WHERE active = true'
});

console.log('Query results:', result);
```

### 5. Error Handling

```typescript
try {
  const result = await agent.callTool('database_executeSql', {
    databaseName: 'myPostgres',
    sqlQuery: 'DELETE FROM users WHERE id = 1'
  });
} catch (error) {
  if (error.message.includes('User did not approve')) {
    console.log('Query was not approved by user');
  } else if (error.message.includes('not found')) {
    console.log('Database not found');
  } else {
    console.log('Query execution failed:', error);
  }
}
```

## Configuration

### Plugin Configuration Schema

The plugin configuration uses a Zod schema for validation:

```typescript
const packageConfigSchema = z.object({
  database: DatabaseConfigSchema.optional(),
});

export const DatabaseConfigSchema = z.object({
  providers: z.record(z.string(), z.any())
}).optional();
```

### Configuration Example

```typescript
app.install(databasePlugin, {
  database: {
    providers: {
      production: {
        connectionString: process.env.PROD_DB_URL,
        allowWrites: true
      },
      analytics: {
        connectionString: process.env.ANALYTICS_DB_URL,
        allowWrites: false
      }
    }
  }
});
```

**Note:** The configuration schema accepts a record of provider configurations, but the actual provider instantiation is left to the implementer. The plugin registers the `DatabaseService` and makes it available for tools and context handlers to use.

## Integration

### Plugin Registration

The plugin is installed using the application's install method:

```typescript
import TokenRingApp from "@tokenring-ai/app";
import databasePlugin from "@tokenring-ai/database";

const app = new TokenRingApp();

app.install(databasePlugin, {
  database: {
    providers: {}
  }
});
```

### Service Registration

The `DatabaseService` is automatically registered when the plugin is installed with a database configuration:

```typescript
export default {
  name: "@tokenring-ai/database",
  version: "0.2.0",
  description: "Abstract database resources and interfaces",
  install(app, config) {
    if (config.database) {
      // Wait for ChatService then register tools and context handlers
      app.waitForService(ChatService, chatService => {
        chatService.addTools(tools);
        chatService.registerContextHandlers(contextHandlers);
      });
      // Add service to app's service registry
      app.addServices(new DatabaseService());
    }
  },
  config: packageConfigSchema,
};
```

### Tool Registration

The plugin automatically registers two tools with the ChatService:

- `database_executeSql` - SQL execution tool
- `database_showSchema` - Schema inspection tool

### Context Handler Registration

The plugin automatically registers the `available-databases` context handler with the ChatService.

## RPC Endpoints

This package does not define RPC endpoints. Database operations are performed through the agent tool system.

## State Management

This package does not define state slices. Database providers manage their own connection state.

## Best Practices

- **Singleton Pattern**: Always handle database connections in a singleton pattern to prevent multiple connections to the same database
- **Parameterized Queries**: Use parameterized queries to prevent SQL injection attacks
- **Write Protection**: Use the `allowWrites` flag to restrict write operations, and always require human confirmation for non-SELECT queries
- **Error Handling**: Ensure proper error handling when executing database operations
- **Connection Management**: Always release database connections to avoid resource leaks
- **Schema Validation**: Validate database names using the context handler before executing queries
- **Tool Usage**: Use tools (`database_executeSql` and `database_showSchema`) instead of direct service calls
- **Required Context Handlers**: Always register `available-databases` context handler to provide database names to agents
- **Provider Abstraction**: Implement custom providers for specific database systems to maintain abstraction layer

## Testing

The package uses vitest for unit testing.

**Run Tests:**

```bash
bun test
```

**Run Tests in Watch Mode:**

```bash
bun test:watch
```

**Generate Coverage:**

```bash
bun test:coverage
```

**Test Setup Example:**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import DatabaseService from '../DatabaseService';
import DatabaseProvider from '../DatabaseProvider';

// Mock provider
class MockProvider extends DatabaseProvider {
  async executeSql(sqlQuery: string) {
    return { rows: [], fields: [] };
  }

  async showSchema() {
    return { 'mock_table': 'CREATE TABLE mock_table (...)' };
  }
}

describe('DatabaseService', () => {
  let dbService: DatabaseService;
  let mockProvider: MockProvider;

  beforeEach(() => {
    dbService = new DatabaseService();
    mockProvider = new MockProvider(false);
  });

  afterEach(() => {
    dbService.databases.clear();
  });

  it('registers and retrieves databases', () => {
    dbService.registerDatabase('test-db', mockProvider);

    expect(dbService.getDatabaseByName('test-db')).toBe(mockProvider);
    expect(dbService.getAvailableDatabases()).toEqual(['test-db']);
  });

  it('returns undefined for non-existent database', () => {
    expect(dbService.getDatabaseByName('non-existent')).toBeUndefined();
    expect(dbService.getAvailableDatabases()).toEqual([]);
  });
});
```

## Dependencies

### Production Dependencies

- `@tokenring-ai/app`: Base application framework and plugin system
- `@tokenring-ai/chat`: Chat service for tool and context handler registration
- `@tokenring-ai/agent`: Agent framework for tool execution
- `@tokenring-ai/utility`: Shared utilities including KeyedRegistry for registry pattern
- `zod`: Runtime type validation for configuration and tool inputs

### Development Dependencies

- `bun-types`: TypeScript definitions for Bun
- `vitest`: Unit testing framework
- `typescript`: TypeScript compiler

## Related Components

- `@tokenring-ai/app`: Base application framework and plugin system
- `@tokenring-ai/chat`: Chat service and context handling
- `@tokenring-ai/agent`: Agent-based orchestration
- `@tokenring-ai/utility`: Shared utility functions including KeyedRegistry
- `@tokenring-ai/drizzle-storage`: Drizzle ORM-based storage implementation
- `@tokenring-ai/sqlite-storage`: SQLite database storage implementation
- `@tokenring-ai/mysql`: MySQL database provider implementation

## License

MIT License - see LICENSE file for details.
