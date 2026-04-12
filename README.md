# @tokenring-ai/database

## Overview

The `@tokenring-ai/database` package provides an abstract database layer for managing
database resources within TokenRing AI agents. It enables the registration and
interaction with multiple database connections through a unified `DatabaseService`
that integrates with the TokenRing plugin system and agent framework.

The package focuses on abstraction, requiring implementers to extend
`DatabaseProvider` for specific database types. It supports tool-based interaction
with agents, context handlers for database availability injection, and write
operation protection through human confirmation for non-SELECT queries.

## Key Features

- Abstract database provider interface for multiple database systems
- Unified service management through `DatabaseService` with KeyedRegistry pattern
- Tool-based interaction with agents via ChatService
- Context handlers for database availability injection
- Write protection with human confirmation for non-SELECT queries
- Schema inspection capabilities
- Type-safe tool execution with Zod schemas
- Required context handlers enforcement (`available-databases`)

## Installation

```bash
bun add @tokenring-ai/database
```

## Core Components/API

### DatabaseService

The main service class that implements `TokenRingService` interface. It manages
a registry of `DatabaseProvider` instances using the `KeyedRegistry` from
`@tokenring-ai/utility`.

**Service Properties:**

| Property    | Type                          | Description              |
| ----------- | ----------------------------- | ------------------------ |
| `name`      | `string`                      | Service identifier       |
| `description` | `string`                    | Service description      |
| `databases` | `KeyedRegistry<DatabaseProvider>` | Database provider registry |

**Resource Management Methods:**

```typescript
registerDatabase = this.databases.register
getDatabaseByName = this.databases.getItemByName
getAvailableDatabases = this.databases.getAllItemNames
```

These methods are exposed as arrow functions that delegate to the underlying
`KeyedRegistry` instance.

### DatabaseProvider

Abstract base class for concrete database implementations. All database provider
implementations must extend this class and implement the required methods.

**Constructor:**

```typescript
constructor(private allowWrites: boolean = false)
```

**Properties:**

- `allowWrites: boolean` (private) - Whether write operations are allowed
  (defaults to false)

**ExecuteSqlResult Interface:**

```typescript
export interface ExecuteSqlResult {
  rows: Record<string, string | number | null>[];
  fields: string[];
}
```

**Abstract Methods (must be implemented):**

```typescript
async executeSql(_sqlQuery: string): Promise<ExecuteSqlResult>

async showSchema(): Promise<Record<string, string>>
```

**Note:** The `DatabaseProvider` class provides default implementations that
throw errors. Concrete implementations must override both methods.

### Tools

#### database_executeSql

Executes an arbitrary SQL query on a database. WARNING: Use with extreme caution
as this can modify or delete data.

| Property        | Value                    |
| --------------- | ------------------------ |
| `name`          | `"database_executeSql"`  |
| `displayName`   | `"Database/executeSql"`  |

**Input Schema:**

```typescript
z.object({
  databaseName: z.string().optional()
    .describe("Optional: The name of the database to target."),
  sqlQuery: z.string().describe("The SQL query to execute.")
})
```

**Required Context Handlers:** `["available-databases"]`

**Behavior:**

1. Retrieves the target database from the `DatabaseService`
2. If the query does not start with "SELECT" (case-sensitive), requests human
   approval via `agent.askForApproval()`
3. If approval is denied, throws error: "User did not approve the SQL query."
4. If the database is not found, throws error:
   `[database_executeSql] Database <databaseName> not found`
5. Executes the SQL query and returns results as JSON

**Note:** The SELECT check is case-sensitive. Queries starting with "select"
(lowercase) will also require approval.

**Example Response:**

```json
{
  "type": "json",
  "data": {
    "rows": [
      {"id": 1, "name": "Alice", "active": true},
      {"id": 2, "name": "Bob", "active": false}
    ],
    "fields": ["id", "name", "active"]
  }
}
```

#### database_showSchema

Shows the 'CREATE TABLE' statements (or equivalent) for all tables in the
specified database.

| Property        | Value                    |
| --------------- | ------------------------ |
| `name`          | `"database_showSchema"`  |
| `displayName`   | `"Database/showSchema"`  |

**Input Schema:**

```typescript
z.object({
  databaseName: z.string()
    .describe("The name of the database for which to show the schema.")
})
```

**Required Context Handlers:** `["available-databases"]`

**Behavior:**

1. Retrieves the target database from the `DatabaseService`
2. If the database is not found, throws error:
   `[database_showSchema] Database <databaseName> not found`
3. Calls `showSchema()` on the database provider and returns the schema as JSON

**Example Response:**

```json
{
  "type": "json",
  "data": {
    "users": "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
    "posts": "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)"
  }
}
```

### Context Handlers

#### available-databases

Automatically provides agents with information about available databases.

**Context Item Format:**

```text
/* These are the databases available for the database tool */:
- postgresql
- mysql
- sqlite
```

**Implementation Details:**

- Retrieves all registered database names from the `DatabaseService`
- If no databases are registered, no context item is yielded
- Automatically registered when the plugin is installed with database config
- Required by both tools for tool execution

## Usage Examples

### 1. Implementing a Concrete DatabaseProvider

```typescript
import DatabaseProvider, { ExecuteSqlResult } from '@tokenring-ai/database';

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
  database: {}
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

export const DatabaseConfigSchema = z.object({}).optional();
```

**Note:** The `DatabaseConfigSchema` is exported from
`@tokenring-ai/database` and can be imported for type-safe configuration.

### Configuration Example

The plugin accepts a configuration object with a `database` property, which is
used to signal that the plugin should be activated. The actual database provider
instantiation and registration must be done manually by the implementer.

```typescript
import TokenRingApp from "@tokenring-ai/app";
import databasePlugin from "@tokenring-ai/database";
import { DatabaseService } from "@tokenring-ai/database";
import { PostgresProvider } from "./postgres-provider";

const app = new TokenRingApp();

// Install plugin with database configuration to activate the service
app.install(databasePlugin, {
  database: {} // Empty config signals activation
});

// Manually register database providers with the service
app.waitForService(DatabaseService, dbService => {
  const postgresProvider = new PostgresProvider(
    process.env.PROD_DB_URL,
    true // allowWrites
  );
  dbService.registerDatabase('production', postgresProvider);
});
```

**Important:** The plugin does not automatically instantiate database providers
from configuration. The configuration object serves two purposes:

1. It signals that the plugin should be activated
2. It triggers the registration of the `DatabaseService`

Implementers must manually create and register database provider instances with
the service after installation.

## Integration

### Plugin Registration

The plugin is installed using the application's install method:

```typescript
import TokenRingApp from "@tokenring-ai/app";
import databasePlugin from "@tokenring-ai/database";

const app = new TokenRingApp();

app.install(databasePlugin, {
  database: {}
});
```

### Service Registration

The `DatabaseService` is registered when the plugin is installed with a database
configuration. The plugin follows this installation flow:

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
      // Register the DatabaseService
      app.addServices(new DatabaseService());
    }
  },
  config: packageConfigSchema,
};
```

**Important Notes:**

- The `DatabaseService` is registered when the plugin is installed with a
  `database` configuration
- The `DatabaseService` is added to the app immediately during plugin installation
- Tools and context handlers are registered asynchronously after the
  `ChatService` is available via `waitForService`
- The plugin does not instantiate database providers - this must be done
  manually by the implementer
- Providers must be registered with the `DatabaseService` after the plugin is
  installed

### Tool Registration

The plugin automatically registers two tools with the ChatService:

| Tool Name             | Description              |
| --------------------- | ------------------------ |
| `database_executeSql` | SQL execution tool       |
| `database_showSchema` | Schema inspection tool   |

### Context Handler Registration

The plugin automatically registers the `available-databases` context handler
with the ChatService.

## Package Exports

The package provides the following exports via its `package.json`:

```json
{
  "exports": {
    ".": "./index.ts",
    "./*": "./*.ts"
  }
}
```

**Main Export (`@tokenring-ai/database`):**

From `index.ts`:

- `DatabaseConfigSchema` - Zod schema for plugin configuration
- `DatabaseProvider` - Abstract base class for database providers
- `DatabaseService` - Main service class for managing database providers

**Direct Imports (available via `./*` pattern):**

- `@tokenring-ai/database/DatabaseService` - Direct import of DatabaseService
- `@tokenring-ai/database/DatabaseProvider` - Direct import of DatabaseProvider
- `@tokenring-ai/database/plugin` - Plugin definition
- `@tokenring-ai/database/tools` - Tool definitions
- `@tokenring-ai/database/contextHandlers` - Context handler definitions

## RPC Endpoints

This package does not define RPC endpoints. Database operations are performed
through the agent tool system.

## State Management

This package does not define state slices. Database providers manage their own
connection state.

## Best Practices

- **Singleton Pattern**: Always handle database connections in a singleton
  pattern to prevent multiple connections to the same database

- **Parameterized Queries**: Use parameterized queries to prevent SQL injection
  attacks

- **Write Protection**: Use the `allowWrites` flag to restrict write operations.
  Non-SELECT queries automatically require human confirmation via
  `agent.askForApproval()`

- **Error Handling**: Ensure proper error handling when executing database
  operations. Tool errors include descriptive messages for database not found
  and approval denial

- **Connection Management**: Always release database connections to avoid
  resource leaks. Use try/finally patterns or connection pooling

- **Schema Validation**: The `available-databases` context handler provides
  database names to agents. Tools validate database existence before execution

- **Tool Usage**: Prefer using tools (`database_executeSql` and
  `database_showSchema`) for agent interactions. They include built-in safety
  checks and context handling

- **Required Context Handlers**: The `available-databases` context handler is
  required by both tools. It is automatically registered when the plugin is
  installed with a database configuration and the ChatService is available

- **Case-Sensitive SELECT Check**: The write protection check is case-sensitive.
  Only queries starting with uppercase "SELECT" bypass the approval requirement

- **Provider Abstraction**: Implement custom providers for specific database
  systems (PostgreSQL, MySQL, SQLite, etc.) to maintain the abstraction layer

- **Manual Provider Registration**: The plugin does not automatically
  instantiate providers from configuration. After installing the plugin,
  manually create and register provider instances:

  ```typescript
  app.install(databasePlugin, { database: {} });
  app.waitForService(DatabaseService, dbService => {
    const provider = new MyCustomProvider(config);
    dbService.registerDatabase('mydb', provider);
  });
  ```

- **Service Availability**: The `DatabaseService` is available immediately after
  plugin installation. Tools and context handlers are registered after
  `ChatService` is available

- **Tool Execution Flow**: Tools retrieve the database from `DatabaseService`,
  perform safety checks (approval for writes), then execute the operation and
  return JSON results

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
import DatabaseService from './DatabaseService';
import DatabaseProvider from './DatabaseProvider';

// Mock provider for testing
class MockProvider extends DatabaseProvider {
  async executeSql(sqlQuery: string) {
    // Implement mock behavior
    return { rows: [], fields: [] };
  }

  async showSchema() {
    // Implement mock behavior
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

**Testing Tools:**

When testing tools, mock the `Agent` and `DatabaseService`:

```typescript
import { describe, it, expect } from 'vitest';
import executeSql from './tools/executeSql';
import DatabaseService from './DatabaseService';
import Agent from '@tokenring-ai/agent/Agent';

// Mock agent
const mockAgent = {
  requireServiceByType: () => mockDbService,
  askForApproval: async () => true, // Auto-approve for testing
} as unknown as Agent;

// Mock database service
const mockDbService = {
  getDatabaseByName: () => ({
    executeSql: async (query: string) => ({ rows: [], fields: [] }),
  }),
} as unknown as DatabaseService;

describe('executeSql tool', () => {
  it('executes SELECT queries without approval', async () => {
    const result = await executeSql(
      { databaseName: 'test', sqlQuery: 'SELECT * FROM users' },
      mockAgent
    );
    expect(result.type).toBe('json');
  });

  it('requests approval for non-SELECT queries', async () => {
    // Setup mock to return false for approval
    (mockAgent.askForApproval as any) = async () => false;

    await expect(
      executeSql(
        { databaseName: 'test', sqlQuery: 'DELETE FROM users' },
        mockAgent
      )
    ).rejects.toThrow('User did not approve');
  });
});
```

## Dependencies

### Production Dependencies

| Package                    | Version | Description                                      |
| -------------------------- | ------- | ------------------------------------------------ |
| `@tokenring-ai/app`        | 0.2.0   | Base application framework and plugin system     |
| `@tokenring-ai/chat`       | 0.2.0   | Chat service for tool registration               |
| `@tokenring-ai/agent`      | 0.2.0   | Agent framework for tool execution               |
| `@tokenring-ai/utility`    | 0.2.0   | Shared utilities including KeyedRegistry         |
| `zod`                      | ^4.3.6  | Runtime type validation                          |

### Development Dependencies

| Package         | Version | Description                    |
| --------------- | ------- | ------------------------------ |
| `bun-types`     | ^1.3.11 | TypeScript definitions for Bun |
| `vitest`        | ^4.1.1  | Unit testing framework         |
| `typescript`    | ^6.0.2  | TypeScript compiler            |

## Related Components

### Core Dependencies

- `@tokenring-ai/app`: Base application framework and plugin system
- `@tokenring-ai/chat`: Chat service and context handling
- `@tokenring-ai/agent`: Agent-based orchestration
- `@tokenring-ai/utility`: Shared utility functions including KeyedRegistry

### Related Database Packages

Concrete database provider implementations that extend `DatabaseProvider`:

- `@tokenring-ai/drizzle-storage`: Drizzle ORM-based storage
- `@tokenring-ai/sqlite-storage`: SQLite database storage
- `@tokenring-ai/mysql`: MySQL database provider (if available)

Note: These packages implement the `DatabaseProvider` interface to provide
concrete database functionality while leveraging the abstract service layer
provided by this package.

## License

MIT License - see LICENSE file for details.
