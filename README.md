# @token-ring/database

Abstract database resources and tools for the Token Ring ecosystem. This package defines a common interface (DatabaseResource) for database connectivity and ships with small, registry-driven tools for executing SQL, listing databases, and showing schema.

It does not implement a concrete database driver by itself. Instead, you create a subclass of DatabaseResource for your target database (e.g., PostgreSQL, MySQL, SQLite, etc.) and register an instance in the Registry. The included tools then discover that resource and delegate operations to it.

## Features
- Abstract DatabaseResource with standardized constructor properties
  - host, port, user, password, databaseName
- Minimal lifecycle methods (start, stop, status)
- Strongly-typed getters for connection details
- Tools (registry-driven):
  - listDatabases: returns databases accessible to the configured connection
  - executeSql: executes arbitrary SQL (supports optional databaseName and queryParams)
  - showSchema: shows schema/DDL for all tables in a specified database
- Zod-based parameter schemas for tools

## Installation

This package is part of the Token Ring monorepo. In a workspace-aware setup, you can reference it directly:

```
npm i @token-ring/database
# or
pnpm add @token-ring/database
# or
bun add @token-ring/database
```

Ensure that its peer dependency @token-ring/registry is also available in your project.

## Overview

The package exports:
- DatabaseResource (abstract class): you must subclass this to implement database-specific logic.
- tools: a small set of helper modules that operate via a Registry, discovering the first registered DatabaseResource.
- name, description, version: simple package metadata.

```
import { DatabaseResource, tools } from "@token-ring/database";
```

## Implementing a concrete DatabaseResource

Create a subclass that implements the abstract methods executeSql, listDatabases, and showSchema. The constructor should forward the required properties to super and store any driver-specific handles as needed.

Example (pseudo-implementation):

```ts
import DatabaseResource from "@token-ring/database/DatabaseResource";

export class PostgresDatabaseResource extends DatabaseResource {
  private client: any;

  async start() {
    // Initialize your client/connection pool using
    // this.getHost(), this.getPort(), this.getUser(), this.getPassword(), this.getDatabaseName()
  }

  async stop() {
    // Close connections
  }

  async executeSql(sqlQuery: string, params?: Record<string, any>): Promise<any> {
    // Implement execution, optionally using params.databaseName or params.values
    // return rows / driver result
  }

  async listDatabases(): Promise<string[]> {
    // Query driver / server catalogs
    return [];
  }

  async showSchema(databaseName: string): Promise<Record<string, any> | string> {
    // Return DDL or an object describing tables/columns
    return {};
  }
}
```

Constructor properties (also described in the class as static constructorProperties):
- host: string (required)
- port: number (optional)
- user: string (required)
- password: string (required)
- databaseName: string (optional)

## Using with the Registry

The tools operate via a Registry and will look up the first registered DatabaseResource.

```ts
import { ServiceRegistry } from "@token-ring/registry";
import { tools } from "@token-ring/database";
import { PostgresDatabaseResource } from "./PostgresDatabaseResource";

const registry = new ServiceRegistry();

// Register your concrete resource
registry.registerResource(
  new PostgresDatabaseResource({
    host: "db.example.com",
    port: 5432,
    user: "app",
    password: "secret",
    databaseName: "appdb",
  })
);

// Start the resource if your app lifecycle requires it
// await resource.start(registry);

// Now use tools
const databases = await tools.listDatabases.execute({}, registry);
console.log("Databases:", databases);

const result = await tools.executeSql.execute(
  {
    sqlQuery: "SELECT * FROM users WHERE id = $1",
    queryParams: { values: [42] },
  },
  registry
);
console.log("Query result:", result);

const schema = await tools.showSchema.execute({ databaseName: "appdb" }, registry);
console.log("Schema:", schema);
```

Notes:
- The executeSql tool supports passing databaseName and queryParams through to your resource implementation so you can decide how to use them (e.g., choose a DB, prepared statement values, etc.).
- If no DatabaseResource is registered, tools will return an error like: "Configuration error: DatabaseResource not found".

## API Reference

### Class: DatabaseResource

Abstract base class for all database resource implementations.

Key methods to implement in subclasses:
- executeSql(sqlQuery: string, params?: Record<string, any>): Promise<any>
- listDatabases(): Promise<string[]>
- showSchema(databaseName: string): Promise<Record<string, any> | string>

Getters provided:
- getHost(): string
- getPort(): number | undefined
- getUser(): string
- getPassword(): string
- getDatabaseName(): string | undefined

Lifecycle methods (optional to override):
- start(registry: Registry): Promise<void>
- stop(registry: Registry): Promise<void>
- status(registry: Registry): Promise<{ active: boolean; service: string }>

### Tools

All tools are accessed via the tools barrel export:

- tools.listDatabases.execute({}, registry)
  - Returns string[] or { error: string }
- tools.executeSql.execute({ databaseName?, sqlQuery, queryParams? }, registry)
  - Returns any or { error: string }
  - Description: "Executes an arbitrary SQL query... WARNING: Use with extreme caution as this can modify or delete data."
- tools.showSchema.execute({ databaseName }, registry)
  - Returns Record<string, any> | string | { error: string }

Each tool exports a zod parameters schema and a human-readable description.

## Safety and Best Practices
- executeSql is powerful and potentially destructive. Avoid using it with untrusted input. Prefer parameterized queries.
- Restrict permissions of the configured database user appropriately.
- Implement resource-specific input validation and error handling in your subclass.

## License

MIT (see LICENSE in the repository root).
