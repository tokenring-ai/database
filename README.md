# @tokenring-ai/database

## Overview

The `@tokenring-ai/database` package provides a unified SQL interface for schema
inspection, structured row browsing, and query execution across multiple
database providers. It integrates with the TokenRing plugin system through a
`DatabaseService` that manages datasource connections registered by URL scheme,
tool-based interaction with agents, RPC endpoints for frontend database apps,
context handlers for datasource availability injection, and a lifecycle hook
that attaches the active table schema and selected rows to chat messages.

The package ships with built-in MySQL/MariaDB, PostgreSQL, and SQLite providers
and a `DatabaseProviderFactory` pattern so new database systems can be added by
registering a factory under a URL scheme (e.g. `mysql://`, `postgres://`,
`sqlite://`).

## Key Features

- **Multi-provider support**: Datasources are registered by URL scheme; the
  plugin ships with MySQL/MariaDB, PostgreSQL, and SQLite factories
- **Structured row browsing**: The `database_selectRows` tool provides
  parameterized, safe reads with column selection, filtering, sorting, and
  paging — no SQL injection surface
- **Write protection**: Non-read-only queries are blocked on datasources with
  `allowWrites: false` and require human approval when writes are enabled
- **Schema introspection**: List tables, describe columns, and view DDL through
  provider-agnostic types
- **Agent state management**: Tracks the active datasource, table, schema, and
  selected rows per agent, with state inheritance to child agents
- **Context injection**: Injects available datasource names (and the active one)
  into agent context automatically
- **Lifecycle hook**: Attaches the active table schema and selected rows to chat
  messages so the agent can reason about the user's current selection
- **RPC layer**: Full CRUD RPC endpoint for frontend database browsing apps
- **Secret-backed connections**: Connection strings are stored as secret
  references and resolved at configuration time

## Installation

```bash
bun add @tokenring-ai/database
```

## Chat Commands

No chat commands defined in this package. Interaction is performed through
tools.

## Tools

| Tool | Display Name | Description |
|------|--------------|-------------|
| `database_executeSql` | Database/executeSql | Executes an arbitrary SQL query on a datasource. Prefer `database_selectRows` for simple lookups. WARNING: Use with extreme caution as this can modify or delete data. |
| `database_showSchema` | Database/showSchema | Shows the 'CREATE TABLE' statements (or equivalent) for all tables in the specified database. |
| `database_listTables` | Database/listTables | Lists the tables and views available on a datasource. Use this before describing a table or selecting rows. |
| `database_describeTable` | Database/describeTable | Describes one table: its columns, data types, nullability, primary key, and DDL. |
| `database_selectRows` | Database/selectRows | Reads rows from a table with simple column selection, filtering, sorting and paging. Prefer this over `database_executeSql` for straightforward lookups — it is parameterized and cannot modify data. |

All tools use the `datasource` parameter (the datasource name from
configuration) and require the `["datasources"]` context handler.

### database_executeSql

Executes an arbitrary SQL query on a datasource using the `DataSource`
provider.

**Input Schema:**

```typescript
z.object({
  datasource: z.string()
    .describe("The name of the datasource to target."),
  sqlQuery: z.string()
    .describe("The SQL query to execute."),
})
```

**Behavior:**

1. Resolves the target datasource via `resolveDatasource`. If not found,
   returns a failure listing available datasource names.
2. Checks whether the query is read-only using `isReadOnlyQuery` (handles
   `SELECT`, `SHOW`, `DESCRIBE`, `DESC`, `EXPLAIN`, `WITH`, with comment
   stripping and CTE write-detection).
3. If the query is not read-only:
   - If `allowWrites` is `false` for the datasource, returns a failure
     explaining that the datasource is read-only.
   - If `allowWrites` is `true`, requests human approval via
     `agent.askForApproval()`. If approval is denied, throws
     `ToolCallError`.
4. Executes the SQL query and returns the result as a JSON string.

**Result Format:**

Returns an `ExecuteSqlResult` serialized as JSON (see Types below).

### database_showSchema

Shows the `CREATE TABLE` statements (or equivalent) for all tables in the
specified datasource.

**Input Schema:**

```typescript
z.object({
  datasource: z.string()
    .describe("The name of the datasource to target."),
})
```

**Result Format:**

Returns `Record<string, string>` mapping table names to their CREATE TABLE
statements, serialized as JSON.

### database_listTables

Lists the tables and views visible to the datasource connection.

**Input Schema:**

```typescript
z.object({
  datasource: z.string()
    .describe("The name of the datasource to target."),
})
```

**Result Format:**

Returns a markdown list. Views are annotated with `(view)`.

### database_describeTable

Describes one table's columns, data types, nullability, primary key, and DDL.

**Input Schema:**

```typescript
z.object({
  datasource: z.string()
    .describe("The name of the datasource to target."),
  table: z.string()
    .describe("The name of the table to describe."),
})
```

**Behavior:**

If the table does not exist, returns a failure suggesting
`database_listTables`.

**Result Format:**

Returns a `TableSchema` object serialized as JSON (see Types below).

### database_selectRows

Reads rows from a table with column selection, filtering, sorting, and paging.
This is the preferred tool for simple lookups — it is fully parameterized and
cannot modify data.

**Input Schema:**

```typescript
z.object({
  datasource: z.string()
    .describe("The name of the datasource to target."),
  table: z.string()
    .describe("The table to read from."),
  columns: z.array(z.string()).exactOptional()
    .describe("Columns to return. Omit for all columns."),
  filters: z.array(RowFilterSchema).exactOptional()
    .describe("Conditions combined with AND. Operators: eq, ne, lt, lte, " +
      "gt, gte, like, in (value is an array), isNull, isNotNull (no value)."),
  orderBy: z.array(OrderBySchema).exactOptional()
    .describe("Sort columns, applied in order."),
  limit: z.number().int().positive().max(1000).default(100)
    .describe("Maximum rows to return (max 1000)."),
  offset: z.number().int().min(0).default(0)
    .describe("Rows to skip, for paging."),
})
```

**Behavior:**

The provider validates every identifier (table, columns, filter columns, sort
columns) against the real schema and binds all values as SQL parameters. Unknown
identifiers cause an `InvalidSelectRequestError`, surfaced as a failure
suggesting `database_describeTable`.

**Result Format:**

Returns a `SelectRowsResult` serialized as JSON (see Types below).

## Configuration

### Plugin Configuration Schema

The plugin configuration holds named datasources and the agent types available
for database work:

```typescript
const packageConfigSchema = z.object({
  database: DatabaseServiceConfigSchema,
});
```

Where `DatabaseServiceConfigSchema` is:

```typescript
z.object({
  datasources: z.record(z.string(), DatabaseConfiguration).prefault({}),
  agentTypes: z.array(z.string()).default(["database"]),
}).prefault({})
```

Legacy flat datasource records (`{ mydb: { url, allowWrites } }`) are still
accepted and migrated into `{ datasources: … }`.

And each `DatabaseConfiguration` entry is:

```typescript
z.object({
  url: secret({
    label: "Connection String",
    description: "Full connection string, e.g. mysql://user:password@host:3306/dbname",
  }),
  allowWrites: z.boolean().default(false).meta({
    description: "Allow agents to run statements that modify data on this datasource",
  }),
})
```

### Secrets

Connection strings are stored as secret references. The plugin's `reconfigure`
resolves each `url` via `resolveSecret`. If a secret is unset, that datasource
is skipped (not fatal) so the rest of the application boots normally.

### Sample Configuration

```yaml
database:
  agentTypes:
    - database
  datasources:
    production:
      url: "${PROD_DB_URL}"
      allowWrites: false
    analytics:
      url: "${ANALYTICS_DB_URL}"
      allowWrites: true
```

### Agent Configuration

Per-agent defaults are read via `agent.getAgentConfigSlice("database", ...)`:

```typescript
z.object({
  datasource: z.string().exactOptional()
    .meta({ description: "Datasource selected when the agent starts" }),
}).prefault({});
```

### Built-in Provider Registration

The plugin registers built-in provider factories during installation:

```typescript
databaseService.registerFactory("mysql", classFactory(MySQLDatabaseProvider));
databaseService.registerFactory("mariadb", classFactory(MySQLDatabaseProvider));
```

The scheme is derived from the connection URL (`mysql://...` -> `mysql`). To
support a new database system, register an additional factory.

## Core Components

### Types

The package defines provider-agnostic types for schema introspection and row
browsing.

#### Cell Types

```typescript
type CellValue = string | number | boolean | null;
type Row = Record<string, CellValue>;
```

#### ExecuteSqlResult

| Property | Type      | Description                             |
|----------|-----------|-----------------------------------------|
| `rows`   | `Row[]`   | Array of result rows as key-value pairs |
| `fields` | `string[]`| Array of column/field names             |

#### TableRef

| Property | Type                  | Description                                    |
|----------|-----------------------|------------------------------------------------|
| `name`   | `string`              | Table or view name                             |
| `schema` | `string` (optional)   | Owning schema/database when provider namespaces |
| `type`   | `"table" \x7C "view"` | Whether this is a table or a view              |

#### ColumnDef

| Property       | Type               | Description                                  |
|----------------|--------------------|----------------------------------------------|
| `name`         | `string`           | Column name                                  |
| `dataType`     | `string`           | Provider-native type, e.g. `varchar(255)`    |
| `nullable`     | `boolean`          | Whether the column allows NULL               |
| `isPrimaryKey` | `boolean`          | Whether the column is part of the primary key |
| `defaultValue` | `string \x7C null` | Default value expression                     |
| `comment`      | `string` (optional)| Column comment                               |

#### TableSchema

| Property     | Type             | Description                                            |
|--------------|------------------|--------------------------------------------------------|
| `table`      | `TableRef`       | Table reference                                        |
| `columns`    | `ColumnDef[]`    | Column definitions                                     |
| `primaryKey` | `string[]`       | Primary key column names                               |
| `ddl`        | `string` (optional) | `CREATE TABLE` statement or equivalent              |

#### SelectRowsRequest

| Property  | Type            | Description                                       |
|-----------|-----------------|---------------------------------------------------|
| `table`   | `string`        | Table to read from                                |
| `columns` | `string[]` (optional) | Columns to return; omit for all              |
| `filters` | `RowFilter[]` (optional) | Conditions combined with AND               |
| `orderBy` | `OrderBy[]` (optional) | Sort columns, applied in order              |
| `limit`   | `number`        | Maximum rows (hard ceiling: `MAX_ROW_LIMIT` = 1000) |
| `offset`  | `number`        | Rows to skip for paging                           |

#### SelectRowsResult

| Property     | Type               | Description                                              |
|--------------|--------------------|----------------------------------------------------------|
| `rows`       | `Row[]`            | Result rows                                              |
| `fields`     | `string[]`         | Columns actually selected, in order                     |
| `totalCount` | `number \x7C null` | Total matching rows ignoring limit/offset; null if unknown |
| `hasMore`    | `boolean`          | Whether more rows exist beyond this page                |

#### RowFilter

| Property | Type                                        | Description                                        |
|----------|---------------------------------------------|----------------------------------------------------|
| `column` | `string`                                    | Column to filter on                                |
| `op`     | `FilterOperator`                            | Comparison operator (see below)                    |
| `value`  | `CellValue \x7C (string \x7C number)[]` (optional) | Filter value; array for `in`, omitted for `isNull`/`isNotNull` |

**FilterOperator** values: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `like`, `in`,
`isNull`, `isNotNull`.

#### OrderBy

| Property   | Type              | Description          |
|------------|-------------------|----------------------|
| `column`   | `string`          | Column to sort by    |
| `direction`| `"asc" \x7C "desc"` | Sort direction     |

### DataSource Interface

The `DataSource` interface defines the provider contract. Providers implement
all methods:

```typescript
interface DataSource {
  executeSql(sqlQuery: string): Promise<ExecuteSqlResult>;
  showSchema(): Promise<Record<string, string>>;
  listTables(): Promise<TableRef[]>;
  getTableSchema(table: string): Promise<TableSchema>;
  selectRows(request: SelectRowsRequest): Promise<SelectRowsResult>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

Providers are created by a `DatabaseProviderFactory`:

```typescript
type DatabaseProviderFactory = (options: DataSourceOptions) => DataSource;
```

#### DataSourceOptions

| Property      | Type      | Description                                       |
|---------------|-----------|---------------------------------------------------|
| `url`         | `string`  | Full connection string                            |
| `allowWrites` | `boolean` | Whether write statements are permitted            |

### Utility Functions

#### schemeOf

Location: `DatabaseService.ts`

```typescript
function schemeOf(url: string): string
```

Extracts the URL scheme from a connection string (`mysql://...` -> `mysql`).
Throws if the string is not a valid URL.

#### resolveDatasource

Location: `util/resolveDatasource.ts`

```typescript
function resolveDatasource(
  datasourceName: string,
  toolLabel: string,
  agent: Agent,
): { datasource: DataSource; service: DatabaseService }
  \x7C { failure: TokenRingToolResult }
```

Looks up a datasource by name, returning a ready-to-return tool failure listing
available datasource names when the name does not match. Used by every
`database_*` tool.

#### isReadOnlyQuery

Location: `util/isReadOnlyQuery.ts`

```typescript
function isReadOnlyQuery(sql: string): boolean
```

Determines whether a SQL statement only reads. Strips leading comments first so
`/* x */ DELETE ...` cannot masquerade as a read. Recognizes `SELECT`, `SHOW`,
`DESCRIBE`, `DESC`, `EXPLAIN`, and `WITH` (CTE) as read-only leading keywords.
A CTE is read-only only if its body does not contain write keywords
(`INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `MERGE`, `DROP`, `ALTER`, `CREATE`,
`TRUNCATE`, `GRANT`, `REVOKE`).

Also exports `stripLeadingComments(sql: string): string`.

#### buildSelect

Location: `util/buildSelect.ts`

```typescript
function buildSelect(
  request: SelectRowsRequest,
  columns: ColumnDef[],
  options?: BuildSelectOptions,
): BuiltSelect
```

Turns a `SelectRowsRequest` into parameterized SQL plus a count query. Every
identifier (table, columns, filter columns, sort columns) is validated against
the provided column definitions and rejected via `InvalidSelectRequestError`
when unknown. Values are always bound as SQL parameters. The limit is clamped to
`MAX_ROW_LIMIT` (1000).

Exports `BuiltSelect` (with `sql`, `params`, `countSql`, `countParams`,
`fields`, `limit`, `offset`), `InvalidSelectRequestError`, and
`BuildSelectOptions` (with optional `quoteIdentifier`).

#### normalizeCellValue

Location: `util/normalizeCellValue.ts`

```typescript
function normalizeCellValue(value: unknown): CellValue
```

Coerces a driver-returned value into the `CellValue` contract
(`string | number | boolean | null`). Handles `Buffer`/`Uint8Array` (UTF-8 text
or base64), `Date` (ISO string), `bigint` (number if safe, string if not),
`undefined` (null), and objects (JSON string).

Also exports:

- `normalizeRow(row: Record<string, unknown>): Row` — normalizes every cell of
  one row.
- `normalizeRows(rows: Iterable<Record<string, unknown>>): Row[]` — normalizes
  every cell of every row.
- `normalizeCount(value: unknown): number | null` — reads a driver-returned
  scalar as a number, tolerating bigint/string/Buffer.

## Services

### DatabaseService

Location: `DatabaseService.ts`

The `DatabaseService` is a `TokenRingService` that manages datasource
connections and provider factories using the `KeyedRegistry` pattern.

**Registry Accessors:**

| Method | Description |
|--------|-------------|
| `registerFactory(scheme, factory)` | Registers a provider factory under a URL scheme |
| `requireDataSource(name)` | Gets a datasource by name (throws if missing) |
| `getDataSource(name)` | Gets a datasource by name (returns `undefined` if missing) |
| `getDatasourceNames()` | Returns an array of all registered datasource names |
| `getDataSourceConfig(name)` | Returns the resolved configuration (`url`, `allowWrites`) for a datasource |

**Reconfiguration:**

`reconfigure(config: ResolvedDatabaseServiceConfig)` reconciles datasources
against the new configuration:

- **Creating**: Builds a new datasource via the factory matching the URL scheme.
- **Deleting**: Disposes the removed datasource.
- **Updating**: If the configuration changed, builds a replacement first (so a
  build failure leaves the existing connection intact), then disposes the old
  one.
- Unchanged datasources are left untouched (compared via `deepEqual`).

**Agent State Methods:**

| Method | Description |
|--------|-------------|
| `attach(agent, creationContext)` | Initializes `DatabaseState` on the agent from the agent config; pushes the datasource name to creation context items |
| `setActiveDatasource(name, agent)` | Sets the active datasource; clears active table, schema, and selected rows |
| `selectTable(datasourceName, table, agent)` | Fetches and caches the table schema; updates active datasource/table/schema; clears stale selected rows |
| `setSelectedRows(rows, agent)` | Updates the selected rows on the agent state |

**State:** Maintains persistent configuration (`config`) and two registries
(`datasources`, `factories`). State is reconciled on every `reconfigure` call.

### MySQLDatabaseProvider

Location: `providers/MySQLDatabaseProvider.ts`

A built-in `DataSource` implementation for MySQL and MariaDB using Bun's
built-in `SQL` client.

**Features:**

- Uses Bun's `SQL` with the `mysql` adapter
- Caches table schemas per table for identifier validation
- Normalizes all returned values through `normalizeCellValue`
- Produces provider-agnostic `TableRef`, `ColumnDef`, and `TableSchema` from
  `information_schema`
- Implements `selectRows` via `buildSelect` with parameterized queries

### PostgreSQLDatabaseProvider

Location: `providers/PostgreSQLDatabaseProvider.ts`

Registered under `postgres://` and `postgresql://`.

- Uses Bun's `SQL` with the `postgres` adapter
- Introspects via `information_schema` / `pg_catalog` (`format_type`, primary keys)
- Supports schema-qualified table names (`schema.table`)
- Double-quoted identifiers and `$1, $2, …` parameter placeholders
- Synthesizes `CREATE TABLE` DDL (and `pg_get_viewdef` for views)

### SQLiteDatabaseProvider

Location: `providers/SQLiteDatabaseProvider.ts`

Registered under `sqlite://` and `file://` (plus bare `:memory:`).

- Uses Bun's `SQL` with the `sqlite` adapter
- Introspects via `sqlite_master` and `pragma_table_info`
- Supports file paths and in-memory databases (`sqlite://:memory:`)
- Double-quoted identifiers and `?` parameter placeholders
- Returns native `CREATE TABLE` / `CREATE VIEW` SQL from `sqlite_master`

## RPC Endpoints

Location: `rpc/database.ts` (schema: `rpc/schema.ts`)

**Path:** `/rpc/database`

**Name:** Database RPC

| Method | Type | Description |
|--------|------|-------------|
| `getDatabaseConfiguration` | query | Returns configured datasources (name, scheme, `allowWrites`) and available `agentTypes` (connection strings never leave the server) |
| `testConnection` | mutation | Tests a datasource connection by listing tables; returns `ok`, `tableCount` on success, or `error` message |
| `listTables` | query | Lists tables and views on a datasource |
| `getTableSchema` | query | Returns the full `TableSchema` for a table |
| `selectRows` | query | Reads rows with column selection, filtering, sorting, and paging |
| `getDatabaseState` | query | Returns the current database state for an agent (active datasource, table, schema, selected row count, available datasources) |
| `updateDatabaseState` | mutation | Updates an agent's database state (active datasource, active table, selected rows); returns the projected state |

**`getDatabaseState` / `updateDatabaseState` result** is a discriminated union
on `status`:

| Status | Additional Fields |
|--------|-------------------|
| `success` | `activeDatasource`, `activeTable`, `activeTableSchema`, `selectedRowCount`, `availableDatasources` |
| `agentNotFound` | (none) |

## Lifecycle Hooks

### addSelectedRows

Location: `hooks/addSelectedRows.ts`

**Display Name:** Database/Add selected rows to chat

Hook type: `BeforeInputReceived`

Attaches the active table's schema and the currently selected rows to the chat
message as attachments. This ensures the agent can reason about the user's
current selection in the Database app.

**Behavior:**

- If the active table schema has not been attached for the current
  datasource/table combination, attaches it as a markdown table with columns,
  types, nullability, primary key, default values, and optional DDL.
- If selected rows exist and their fingerprint has changed, attaches them as a
  JSON array.
- Attachments are capped at 100 rows and 256 KB; truncation is noted in the
  attachment description.
- Uses a content fingerprint so re-attaching identical data is avoided.

**Attachment Properties:**

| Attachment | `mimeType` | `encoding` | Description |
|-----------|------------|------------|-------------|
| Schema | `text/markdown` | `text` | Markdown table of the active table's columns and DDL |
| Selected rows | `application/json` | `text` | JSON array of selected row data |

## Context Handlers

### datasources

Location: `contextHandlers/datasources.ts`

Injects a user context item listing the available datasource names configured
for the `database_*` tools. The active datasource is annotated, including the
currently viewed table if one is active. The context handler yields nothing
when no datasources are configured.

## Agent State

### DatabaseState

Location: `state/DatabaseState.ts`

An `AgentStateSlice` that tracks the agent's database interaction context:

| Property | Type | Description |
|----------|------|-------------|
| `activeDatasource` | `string \| undefined` | The datasource currently in use |
| `activeTable` | `string \| undefined` | The table currently being browsed |
| `activeTableSchema` | `TableSchema \| undefined` | Cached schema of the active table |
| `selectedRows` | `Row[]` | Rows selected in the Database app (default `[]`) |
| `lastAttachedSchemaKey` | `string \| undefined` | `datasource:table` of the schema last attached |
| `lastAttachedSelectionKey` | `string \| undefined` | `datasource:table:fingerprint` of the rows last attached |

**State Inheritance:** `transferStateFromParent` inherits `activeDatasource`,
`activeTable`, and `activeTableSchema` from the parent agent when not already
set.

**Serialization:** Fully serializable via `serialize`/`deserialize` using the
`serializationSchema`.

## Schema Documentation

The following Zod schemas are exported from `schema.ts`:

| Schema | Purpose |
|--------|---------|
| `DatabaseConfiguration` | Single datasource config: `url` (secret) and `allowWrites` (default `false`) |
| `DatabaseServiceConfigSchema` | Object with `datasources` record and `agentTypes` (default `["database"]`); accepts legacy flat datasource records |
| `DatabaseAgentConfigSchema` | Per-agent config: `datasource` (optional default datasource) |
| `FilterOperatorSchema` | `z.enum(filterOperators)` |
| `RowFilterSchema` | One filter condition: `column`, `op`, optional `value` |
| `OrderBySchema` | Sort column: `column`, `direction` (default `asc`) |
| `SelectRowsRequestSchema` | Full select request with defaults: `limit` (100), `offset` (0) |
| `TableRefSchema` | Table reference with name, optional schema, and type |
| `ColumnDefSchema` | Column definition |
| `TableSchemaSchema` | Full table schema |
| `CellValueSchema` | `z.union([string, number, boolean, null])` |
| `RowSchema` | `z.record(string, CellValueSchema)` |

**Constant:** `MAX_ROW_LIMIT = 1000` — hard ceiling on rows per select request.

### Schema Metadata

- `DatabaseConfiguration.url` uses `secret()` with label "Connection String"
- `DatabaseConfiguration.allowWrites` uses `.meta()` with description for
  configuration UI
- `DatabaseAgentConfigSchema.datasource` uses `.meta()` with description

## Testing

Tests are written with `bun:test` and run with `bun test`.

| Test File | What it Tests |
|-----------|---------------|
| `test/buildSelect.test.ts` | SQL generation, identifier validation, parameter binding, filter operators, paging, count queries |
| `test/normalizeCellValue.test.ts` | Cell value normalization for Buffer, Date, bigint, objects; row and count normalization |
| `test/DatabaseService.test.ts` | `schemeOf` extraction, datasource lifecycle (create, update, dispose), `allowWrites` config |
| `test/isReadOnlyQuery.test.ts` | Read-only detection, comment stripping, CTE write-detection, keyword matching |

## Dependencies

| Package | Purpose |
|---------|---------|
| `@tokenring-ai/app` | Plugin system, service registration |
| `@tokenring-ai/chat` | Chat tools, context handlers, `ToolCallError` |
| `@tokenring-ai/agent` | Agent state slices, lifecycle events (`BeforeInputReceived`) |
| `@tokenring-ai/lifecycle` | Hook registration (`AgentLifecycleService`) |
| `@tokenring-ai/rpc` | RPC endpoint creation and schema types |
| `@tokenring-ai/secrets` | Secret resolution for connection strings |
| `@tokenring-ai/utility` | `KeyedRegistry`, `classFactory`, `deepEqual`, `markdownList`, `formatError` |
| `zod` | Schema validation |

**Runtime:** Uses Bun's built-in `SQL` client for MySQL/MariaDB connections.

## License

MIT License - see LICENSE file for details.
