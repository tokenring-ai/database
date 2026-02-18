# @tokenring-ai/database

## Overview

The `@tokenring-ai/database` package provides an abstract database layer for managing database resources within TokenRing AI agents. It enables the registration and interaction with multiple database connections through a unified `DatabaseService` that integrates with the TokenRing plugin system and agent framework.

## Installation

```bash
bun install @tokenring-ai/database
```

## Features

- Abstract database provider interface for multiple database systems
- Unified service management through `DatabaseService` with registry pattern
- Tool-based interaction with agents
- Context handlers for database availability
- Write operation protection with human confirmation for non-SELECT queries
- Schema inspection capabilities

## Configuration

### Configuration Schema

```typescript
import { z } from "zod";

const DatabaseConfigSchema = z.object({
  providers: z.record(z.string(), z.any())
}).optional();
```

### Plugin Configuration

The plugin configuration is optional. When provided, the plugin will register tools and context handlers:

```typescript
const pluginConfig = {
  database: {
    providers: {
      myPostgres: {},
      myReadonlyDb: {}
    }
  }
};
```

**Note**: The configuration schema is currently a placeholder (`z.any()`) and does not enforce specific provider properties. The actual database provider configuration is handled through the `DatabaseProvider` constructor options.

### Package Exports

This package supports multiple import paths:

```typescript
// Main package import
import { DatabaseConfigSchema, DatabaseProvider, DatabaseService } from '@tokenring-ai/database';

// Direct service import
import DatabaseService from '@tokenring-ai/database/DatabaseService.js';

// Direct provider import
import DatabaseProvider from '@tokenring-ai/database/DatabaseProvider.js';

// Direct tool imports
import executeSql from '@tokenring-ai/database/tools/executeSql.js';
import showSchema from '@tokenring-ai/database/tools/showSchema.js';

// Direct context handler import
import availableDatabases from '@tokenring-ai/database/contextHandlers/availableDatabases.ts';
```

## Plugin Usage

The plugin integrates with TokenRing application framework and provides tools and context handlers.

### Plugin Registration

```typescript
import { TokenRingApp } from "@tokenring-ai/app";
import { DatabaseConfigSchema } from "@tokenring-ai/database";
import databasePlugin from "@tokenring-ai/database";

const app = new TokenRingApp();

app.install(databasePlugin, {
  database: DatabaseConfigSchema.parse({
    providers: {
      myPostgres: {},
      myReadonlyDb: {}
    }
  })
});

// Database service and tools are now available
```

### Plugin Features

- **Tools**: Registers `executeSql` and `showSchema` tools with ChatService
- **Context Handlers**: Registers `available-databases` context handler for showing available databases
- **Service**: Adds DatabaseService to the app's service registry

## Tools

The plugin provides two agent tools that integrate with the TokenRing chat system.

### database_executeSql

Executes an arbitrary SQL query on a database. WARNING: Use with extreme caution as this can modify or delete data.

**Tool Definition:**

```typescript
{
  name: "database_executeSql",
  displayName: "Database/executeSql",
  description: "Executes an arbitrary SQL query on a database using the DatabaseResource. WARNING: Use with extreme caution as this can modify or delete data.",
  inputSchema: {
    databaseName: z.string().optional().describe("Optional: The name of the database to target. May also be specified in the SQL query."),
    sqlQuery: z.string().describe("The SQL query to execute.")
  },
  requiredContextHandlers: ["available-databases"],
  execute: (params, agent) => Promise<TokenRingToolJSONResult>
}
```

**Features:**

- Automatically prompts for human confirmation on non-SELECT queries
- Validates database existence before execution
- Provides detailed error messages for missing databases
- Requires `available-databases` context handler

**Usage Example:**

```typescript
// Execute a SELECT query
await agent.callTool('database_executeSql', {
  databaseName: 'myPostgres',
  sqlQuery: 'SELECT * FROM users WHERE active = true'
});

// Execute with optional database name (can also be specified in SQL query)
await agent.callTool('database_executeSql', {
  sqlQuery: 'SELECT * FROM users WHERE active = true'
});

// Execute a write operation (requires human confirmation)
await agent.callTool('database_executeSql', {
  sqlQuery: 'UPDATE users SET last_login = NOW() WHERE id = 123'
});
```

### database_showSchema

Shows the schema information for all tables in the specified database.

**Tool Definition:**

```typescript
{
  name: "database_showSchema",
  displayName: "Database/showSchema",
  description: "Shows the 'CREATE TABLE' statements (or equivalent) for all tables in the specified database.",
  inputSchema: {
    databaseName: z.string().describe("The name of the database for which to show the schema.")
  },
  requiredContextHandlers: ["available-databases"],
  execute: (params, agent) => Promise<TokenRingToolJSONResult>
}
```

**Features:**

- Validates database existence
- Returns structured schema information as key-value map

**Usage Example:**

```typescript
// Show database schema
const schema = await agent.callTool('database_showSchema', {
  databaseName: 'myPostgres'
});
```

## Services

### DatabaseService

The main service class that implements `TokenRingService`. It manages a registry of `DatabaseProvider` instances.

**Service Interface:**

```typescript
interface TokenRingService {
  name: string;
  description: string;
  readonly databases: KeyedRegistry<DatabaseProvider>;
}
```

**Service Properties:**

- `name`: Service identifier ("DatabaseService")
- `description`: Service description ("Database service")
- `databases`: `KeyedRegistry<DatabaseProvider>` - Registry managing all database provider instances

**Resource Management Methods:**

```typescript
registerDatabase(name: string, provider: DatabaseProvider): void;

getDatabaseByName(name: string): DatabaseProvider | undefined;

getAvailableDatabases(): string[];
```

**Method Descriptions:**

- `registerDatabase(name, provider)`: Registers a new database provider with the service
- `getDatabaseByName(name)`: Retrieves a database provider by name, returns undefined if not found
- `getAvailableDatabases()`: Returns an array of all registered database names

**Service Registration:**

The DatabaseService is registered with the application through the plugin's install method:

```typescript
app.addServices(new DatabaseService());
```

## Providers

### DatabaseProvider

Abstract base class for concrete database implementations. Extend this to connect to specific databases.

**Constructor Options:**

```typescript
interface DatabaseProviderOptions {
  allowWrites?: boolean;
}
```

**Properties:**

- `allowWrites: boolean`: Whether write operations are allowed on this provider (defaults to false)

**Abstract Methods (must be implemented):**

```typescript
async executeSql(sqlQuery: string): Promise<ExecuteSqlResult>;

async showSchema(): Promise<Record<string, string>>;
```

**Result Interfaces:**

```typescript
interface ExecuteSqlResult {
  rows: Record<string, string | number | null>[];
  fields: string[];
}
```

**Method Descriptions:**

- `executeSql(sqlQuery)`: Executes an SQL query and returns structured results
- `showSchema()`: Returns table schemas as a key-value map where keys are table names

**Implementation Example:**

```typescript
import DatabaseProvider from '@tokenring-ai/database/DatabaseProvider.js';

export class PostgresProvider extends DatabaseProvider {
  private pool: Pool;

  constructor(options: { connectionString: string, allowWrites?: boolean }) {
    super({ allowWrites: options.allowWrites ?? false });
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

## RPC Endpoints

This package does not define any RPC endpoints.

## State Management

This package does not implement state management directly. State management is handled through the agent system and service registry.

## Context Handlers

The plugin provides context handlers that inject relevant information into chat sessions.

### available-databases

Automatically provides agents with information about available databases.

**Context Handler Function:**

```typescript
async function* getContextItems(
  input: string,
  chatConfig: ParsedChatConfig,
  params: {},
  agent: Agent
): AsyncGenerator<ContextItem>
```

**Functionality:**

- Yields database names as context items
- Returns empty if no databases are registered
- Provides formatted list of available databases for agent awareness

**Context Item Format:**

```
/* These are the databases available for the database tool */:
- database1
- database2
```

**Required Context Handlers:**

The `database_executeSql` and `database_showSchema` tools require the `available-databases` context handler to be registered.

## Dependencies

### Production Dependencies

- `@tokenring-ai/app` - Base application framework and plugin system
- `@tokenring-ai/chat` - Chat service for tool and context handler registration
- `@tokenring-ai/agent` - Central orchestration system
- `@tokenring-ai/utility` - Shared utilities including KeyedRegistry
- `zod` - Runtime type validation and schema definition

### Development Dependencies

- `bun-types` - TypeScript definitions for Bun
- `vitest` - Unit testing framework
- `typescript` - TypeScript compiler

## Package Structure

```
pkg/database/
├── index.ts                         # Package entry point and export schemas
├── package.json                     # Package metadata and dependencies
├── DatabaseProvider.ts              # Abstract base class for database implementations
├── DatabaseService.ts               # Core service for managing database providers
├── plugin.ts                        # TokenRing plugin integration
├── tools.ts                         # Tool exports
├── tools/
│   ├── executeSql.ts                # SQL execution tool
│   └── showSchema.ts                # Schema inspection tool
├── contextHandlers.ts               # Context handler exports
└── contextHandlers/
    └── availableDatabases.ts        # Database availability context handler
```

### Build and Test

```bash
bun run build       # TypeScript type checking
bun run test        # Run tests
bun run test:watch  # Run tests in watch mode
bun run test:coverage  # Run tests with coverage
```

## Integration

### Agent Integration

The plugin integrates with the agent system through several mechanisms:

**Tool Registration:**

Tools are registered through the plugin's install method using ChatService:

```typescript
app.waitForService(ChatService, chatService => {
  chatService.addTools(tools);
  chatService.registerContextHandlers(contextHandlers);
});
```

**Context Handlers:**

Context handlers are registered through the plugin's install method:

```typescript
app.waitForService(ChatService, chatService => {
  chatService.registerContextHandlers(contextHandlers);
});
```

**Service Registration:**

DatabaseService is added to the app's service registry:

```typescript
app.addServices(new DatabaseService());
```

### Service Usage Examples

#### 1. Using Direct Service API

```typescript
import { DatabaseService } from '@tokenring-ai/database/DatabaseService.js';
import PostgresProvider from './PostgresProvider.js';

// Create the service
const dbService = new DatabaseService();

// Register a database provider
const postgresDb = new PostgresProvider({
  allowWrites: true,
  connectionString: process.env.DB_URL
});

dbService.registerDatabase('myPostgres', postgresDb);

// Register database
const mysqlDb = new MysqlProvider({
  allowWrites: false,
  connection: mysql.createPool(process.env.MYSQL_URL)
});

dbService.registerDatabase('analytics', mysqlDb);

// List available databases
const available = dbService.getAvailableDatabases();
console.log('Available databases:', available);

// Get specific database
const postgresResource = dbService.getDatabaseByName('myPostgres');
if (postgresResource) {
  const schema = await postgresResource.showSchema();
  console.log('Schema:', schema);
}
```

#### 2. Managing Multiple Databases

```typescript
import DatabaseService from '@tokenring-ai/database/DatabaseService.js';
import PostgresProvider from './PostgresProvider.js';
import MysqlProvider from './MysqlProvider.js';

const dbService = new DatabaseService();

// Register multiple databases
dbService.registerDatabase('production', new PostgresProvider({
  allowWrites: true,
  connectionString: process.env.PROD_DB_URL
}));

dbService.registerDatabase('analytics', new PostgresProvider({
  allowWrites: false,
  connectionString: process.env.ANALYTICS_DB_URL
}));

dbService.registerDatabase('cache', new MysqlProvider({
  allowWrites: false,
  connection: mysql.createPool(process.env.CACHE_DB_URL)
}));

// List available databases
const databases = dbService.getAvailableDatabases();
console.log('Available databases:', databases);

// Get database by name
const productionDb = dbService.getDatabaseByName('production');
```

## Best Practices

- **Singleton Pattern**: Always handle database connections in a singleton pattern to prevent multiple connections to the same database.
- **Parameterized Queries**: Use parameterized queries to prevent SQL injection attacks.
- **Write Protection**: Use the `allowWrites` flag to restrict write operations, and always require human confirmation for non-SELECT queries.
- **Error Handling**: Ensure proper error handling when executing database operations.
- **Connection Management**: Always release database connections to avoid resource leaks.
- **Schema Validation**: Validate database names using the `available-databases` context handler before executing queries.
- **Tool Usage**: Use tools (`database_executeSql` and `database_showSchema`) instead of direct service calls.

## Related Components

- `@tokenring-ai/app`: Base application framework and plugin system
- `@tokenring-ai/chat`: Chat service and context handling
- `@tokenring-ai/agent`: Agent-based orchestration
- `@tokenring-ai/utility`: Shared utility functions including KeyedRegistry

## License

MIT License - see [LICENSE](./LICENSE) file for details.
