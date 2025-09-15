# Database Package Documentation

## Overview

The `@tokenring-ai/database` package provides an abstract layer for managing database resources within TokenRing AI agents. It enables the registration, activation, and interaction with multiple database connections through a unified `DatabaseService`. This service integrates with the TokenRing agent framework, allowing AI agents to perform database operations like executing SQL queries, listing available databases, and inspecting schemas.

The package focuses on abstraction, requiring implementers to extend `DatabaseResource` for specific database types (e.g., PostgreSQL, MySQL). It supports read-only and read-write operations, with tools for safe querying and schema exploration. This is particularly useful for AI-driven applications that need to interact with databases dynamically, such as querying data for agent decision-making or maintaining persistent storage.

Key features:
- Multi-database resource management.
- Abstract SQL execution and schema retrieval.
- Integration with TokenRing tools for agent-based execution.
- Write protection configurable per resource.

## Installation/Setup

This package is part of the TokenRing AI monorepo. To use it:

1. Ensure you have Node.js (v18+) installed.
2. Install dependencies via npm:
   ```
   npm install @tokenring-ai/database @tokenring-ai/agent
   ```
3. For development or building:
   ```
   npm install
   npm run build  # If using TypeScript compilation
   ```
4. Implement concrete `DatabaseResource` subclasses for your databases (see Usage Examples).
5. Register resources in your agent's service configuration.

Environment variables or config files for database connections (e.g., connection strings) are handled in concrete implementations, not in this abstract package.

## Package Structure

The package is structured as follows:

- **DatabaseService.ts**: Core service for managing database resources.
- **DatabaseResource.ts**: Abstract base class for database implementations.
- **index.ts**: Package entry point, exports, and tool registration.
- **tools.ts**: Re-exports of agent tools.
- **tools/**:
  - **listDatabases.ts**: Tool to list active databases.
  - **executeSql.ts**: Tool for executing SQL queries.
  - **showSchema.ts**: Tool for retrieving database schemas.
- **package.json**: Package metadata and dependencies.
- **LICENSE**: Licensing information.

Directories like `tools/` contain executable scripts for agent tools.

## Core Components

### DatabaseService

`DatabaseService` is the central manager for database resources, implementing the `TokenRingService` interface. It handles registration, activation, and retrieval of resources, and provides memory yields for agent awareness of available databases.

- **Key Methods**:
  - `registerResource(name: string, resource: DatabaseResource)`: Registers a database resource by name.
  - `enableResources(...names: string[])`: Activates specific resources for use.
  - `getResourceByName(name: string): DatabaseResource`: Retrieves an active resource (throws if not enabled).
  - `getAvailableResources(): string[]`: Lists all registered resources.
  - `getActiveResourceNames(): Set<string>`: Returns names of enabled resources.
  - `async* getMemories(agent: Agent): AsyncGenerator<MemoryItemMessage>`: Yields a message listing available databases for the agent.

Resources interact via the service: Register first, enable as needed, then access through tools or direct calls.

### DatabaseResource

Abstract class for concrete database implementations. Extend this to connect to specific databases.

- **Constructor Options** (`DatabaseResourceOptions`):
  - `allowWrites?: boolean`: Defaults to `false`; enables write operations if `true`.

- **Key Methods** (abstract, must be implemented):
  - `async executeSql(sqlQuery: string): Promise<ExecuteSqlResult>`: Executes SQL and returns `{ rows: Record<string, string | number | null>[], fields: string[] }`. Supports SELECT (reads) and others (writes, if allowed).
  - `async showSchema(): Promise<Record<string, string>>`: Returns table schemas (e.g., 'CREATE TABLE' statements) as a key-value map (table name to schema string).

Error handling: Throws errors for unimplemented methods or invalid states (e.g., writes on read-only resources).

### Tools

Tools are agent-executable functions integrated via the TokenRing framework. They use Zod for input validation and interact with `DatabaseService`.

- **listDatabases**:
  - Description: Lists all active databases.
  - Input: None (`z.object({})`).
  - Output: String like "Available databases: db1, db2".
  - Usage: No parameters needed.

- **executeSql**:
  - Description: Executes an SQL query on a specified database. Warns about potential data modification.
  - Input Schema (`z.object`):
    - `databaseName?: string`: Target database (required in practice).
    - `sqlQuery: string`: The SQL to execute.
  - Output: `ExecuteSqlResult` object or stringified for agent response.
  - Checks: Requires SELECT for reads; throws on writes if not allowed.

- **showSchema**:
  - Description: Retrieves schema for all tables in a database.
  - Input Schema (`z.object`):
    - `databaseName: string`: Required database name.
  - Output: `Record<string, string>` of table schemas.

Tools are executed via agent calls, e.g., `agent.executeTool('database/executeSql', params)`.

## Usage Examples

### 1. Implementing a Concrete DatabaseResource

Extend `DatabaseResource` for a specific database (pseudocode for PostgreSQL):

```typescript
import DatabaseResource, { DatabaseResourceOptions, ExecuteSqlResult } from './DatabaseResource';
import { Pool } from 'pg';  // Example dependency

export class PostgresResource extends DatabaseResource {
  private pool: Pool;

  constructor(options: DatabaseResourceOptions & { connectionString: string }) {
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
      const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';");
      const schemas: Record<string, string> = {};
      for (const row of res.rows) {
        const table = row.table_name;
        const schemaRes = await client.query(`SELECT pg_get_tabledef('${table}'::regclass);`);
        schemas[table] = schemaRes.rows[0].pg_get_tabledef;
      }
      return schemas;
    } finally {
      client.release();
    }
  }
}
```

### 2. Registering and Using DatabaseService in an Agent

```typescript
import { Agent } from '@tokenring-ai/agent';
import DatabaseService from './DatabaseService';
import PostgresResource from './PostgresResource';  // Your implementation

const agent = new Agent();

// Create service and resources
const dbService = new DatabaseService();
const postgresDb = new PostgresResource({ allowWrites: true, connectionString: process.env.DB_URL });
dbService.registerResource('myPostgres', postgresDb);
dbService.enableResources('myPostgres');

// Register service with agent
agent.services.push(dbService);

// Now tools are available, e.g., execute SQL
const result = await agent.executeTool('database/executeSql', {
  databaseName: 'myPostgres',
  sqlQuery: 'SELECT * FROM users LIMIT 5;'
});
console.log(result);  // { rows: [...], fields: ['id', 'name'] }
```

### 3. Listing Databases via Tool

```typescript
const dbList = await agent.executeTool('database/listDatabases', {});
console.log(dbList);  // "Available databases: myPostgres"
```

## Configuration Options

- **allowWrites** (boolean, per DatabaseResource): Controls write permissions. Default: `false`. Set during construction.
- **Database Connections**: Handled in concrete implementations (e.g., via connection strings, env vars like `DB_URL`).
- **Tool Inputs**: Validated via Zod schemas; optional params like `databaseName` in `executeSql`.
- No global config file; configuration is instance-based.

## API Reference

### DatabaseService
- `registerResource(name: string, resource: DatabaseResource): void`
- `enableResources(...names: string[]): void`
- `getResourceByName(name: string): DatabaseResource`
- `getAvailableResources(): string[]`
- `getActiveResourceNames(): Set<string>`
- `async* getMemories(agent: Agent): AsyncGenerator<MemoryItemMessage>`

### DatabaseResource (Abstract)
- Constructor: `(options: DatabaseResourceOptions)`
- `async executeSql(sqlQuery: string): Promise<ExecuteSqlResult>`
- `async showSchema(): Promise<Record<string, string>>`

### Tools (Exported via index.ts)
- `listDatabases.execute(params: {}, agent: Agent): Promise<string>`
- `executeSql.execute(params: {databaseName?: string, sqlQuery: string}, agent: Agent): Promise<string | object>`
- `showSchema.execute(params: {databaseName: string}, agent: Agent): Promise<Record<string, any> | string>`

Each tool includes `name`, `description`, and `inputSchema` for agent integration.

### Interfaces
- `DatabaseResourceOptions`: `{ allowWrites?: boolean }`
- `ExecuteSqlResult`: `{ rows: Record<string, string | number | null>[], fields: string[] }`

## Dependencies

- `@tokenring-ai/agent` (v0.1.0): Core agent framework and types.
- Internal: Uses Zod for schema validation in tools.
- External implementations may require database drivers (e.g., `pg` for PostgreSQL, not included).

## Contributing/Notes

- **Testing**: Implement unit tests for concrete resources using Jest or similar. Test SQL execution and schema retrieval.
- **Building**: Run `npm run eslint` for linting. Use TypeScript for type safety.
- **Known Limitations**:
  - Abstract; requires concrete implementations for real DB connections.
  - Tools assume SQL databases; extend for NoSQL if needed.
  - Write operations are guarded but use with caution in production.
  - Binary results or large datasets may need handling in `executeSql`.
- Contributions: Extend tools or add resource types. Follow TokenRing AI guidelines.
- License: See LICENSE file (typically MIT or similar).

This documentation is based on the current codebase (v0.1.0). For updates, refer to the source files.