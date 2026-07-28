# @tokenring-ai/database

## Overview

The `@tokenring-ai/database` package provides an abstract SQL interface for
schema inspection and query execution across providers. It enables the
registration and interaction with multiple database connections through a
unified `DatabaseService` that integrates with the TokenRing plugin system and
agent framework.

The package focuses on abstraction, requiring implementers to extend
`DataSource` for specific database types. It supports tool-based
interaction with agents, context handlers for database availability injection,
and write operation protection through human confirmation for non-SELECT
queries.

## Key Features

- Abstract database provider interface for multiple database systems
- Unified service management through `DatabaseService` with KeyedRegistry
  pattern
- Tool-based interaction with agents via ChatService
- Context handlers for database availability injection
- Write protection with human confirmation for non-SELECT queries
- Schema inspection capabilities
- Type-safe tool execution with Zod schemas

## Installation

```bash
bun add @tokenring-ai/database
```

## Chat Commands

This package does not define chat commands. Interaction is performed through
tools.

## Tools

| Tool Name             | Display Name        | Description                                                                  |
|-----------------------|---------------------|------------------------------------------------------------------------------|
| `database_executeSql` | Database/executeSql | Executes an arbitrary SQL query on a database. WARNING: Use with extreme caution as this can modify or delete data. |
| `database_showSchema` | Database/showSchema | Shows the 'CREATE TABLE' statements (or equivalent) for all tables in the specified database. |

### database_executeSql

Executes an arbitrary SQL query on a database using the DatabaseResource.
WARNING: Use with extreme caution as this can modify or delete data.

**Input Schema:**

```typescript
z.object({
  databaseName: z.string().exactOptional()
    .describe("Optional: The name of the database to target. May also be specified in the SQL query."),
  sqlQuery: z.string().describe("The SQL query to execute.")
})
```

**Required Context Handlers:** `["available-databases"]`

**Behavior:**

1. Retrieves the target database from the `DatabaseService` using
   `databaseName` or an empty string `""` if not provided
2. If the database is not found, throws `ToolCallError`:
   `"Database ${databaseName} not found"`
3. If the query does not start with `"SELECT"` (case-sensitive), requests
   human approval via `agent.askForApproval()`
4. If approval is denied, throws `ToolCallError`:
   `"User did not approve the SQL query that was provided."`
5. Executes the SQL query and returns the result as a JSON string

**Result Format:**

The tool returns an `ExecuteSqlResult` serialized as JSON:

```typescript
interface ExecuteSqlResult {
  rows: Record<string, string | number | null>[];
  fields: string[];
}
```

### database_showSchema

Shows the 'CREATE TABLE' statements (or equivalent) for all tables in the
specified database.

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
2. If the database is not found, throws `ToolCallError`:
   `"Database ${databaseName} not found"`
3. Calls `showSchema()` on the database provider and returns the schema as a
   JSON string

**Result Format:**

The tool returns a `Record<string, string>` mapping table names to their
CREATE TABLE statements, serialized as JSON.

## Configuration

### Plugin Configuration Schema

The plugin configuration uses a Zod schema for validation:

```typescript
const packageConfigSchema = z.object({
  database: DatabaseConfigSchema.exactOptional(),
});

export const DatabaseConfigSchema = z.object({}).exactOptional();
```

**Note:** The `DatabaseConfigSchema` is exported from
`@tokenring-ai/database` and can be imported for type-safe configuration.

### Configuration Example

The plugin accepts a configuration object with a `database` property, which is
used to signal that the plugin should be activated. The actual database
provider instantiation and registration must be done manually by the
implementer.

```yaml
database: {}
```

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
  dbService.registerDatabase("production", postgresProvider);
});
```

**Important:** The plugin does not automatically instantiate database providers
from configuration. The configuration object serves two purposes:

1. It signals that the plugin should be activated
2. It triggers the registration of the `DatabaseService`

Implementers must manually create and register database provider instances with
the service after installation.

## Extending DatabaseProvider

To support a specific database system, extend the `DataSource` class and
implement the required methods:

```typescript
import DatabaseProvider, { ExecuteSqlResult } from "@tokenring-ai/database";

class MyDatabaseProvider extends DatabaseProvider {
  constructor(allowWrites: boolean = false) {
    super(allowWrites);
  }

  async executeSql(sqlQuery: string): Promise<ExecuteSqlResult> {
    // Implement database-specific SQL execution
    // Return result with rows and fields
    throw new Error("Not implemented");
  }

  async showSchema(): Promise<Record<string, string>> {
    // Implement database-specific schema inspection
    // Return record mapping table names to CREATE TABLE statements
    throw new Error("Not implemented");
  }
}
```

### DatabaseProvider Options

| Option        | Type                  | Description                                    |
|---------------|-----------------------|------------------------------------------------|
| `allowWrites` | `boolean \| undefined` | When true, allows write operations without additional checks |

### ExecuteSqlResult Interface

| Property | Type                                        | Description                              |
|----------|---------------------------------------------|------------------------------------------|
| `rows`   | `Record<string, string \| number \| null>[]` | Array of result rows as key-value pairs  |
| `fields` | `string[]`                                  | Array of column/field names              |

## License

MIT License - see LICENSE file for details.
