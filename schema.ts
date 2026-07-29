import { secret } from "@tokenring-ai/secrets/secret";
import { z } from "zod";
import { filterOperators } from "./types.ts";

export const DatabaseConfiguration = z.object({
  url: secret({
    label: "Connection String",
    description: "Full connection string, e.g. mysql://user:password@host:3306/dbname",
  }),
  allowWrites: z.boolean().default(false).meta({
    description: "Allow agents to run statements that modify data on this datasource",
  }),
});

export type DatabaseConfiguration = z.infer<typeof DatabaseConfiguration>;

export const DatabaseServiceConfigSchema = z.record(z.string(), DatabaseConfiguration).prefault({});

export type DatabaseServiceConfig = z.input<typeof DatabaseServiceConfigSchema>;
export type ParsedDatabaseServiceConfig = z.output<typeof DatabaseServiceConfigSchema>;

/**
 * What {@link DatabaseService} actually consumes. The `url` secret reference is
 * resolved to a plain connection string in the plugin's `reconfigure`, so the
 * service itself never touches the secrets machinery.
 */
export interface ResolvedDatabaseConfiguration {
  url: string;
  allowWrites: boolean;
}

export type ResolvedDatabaseServiceConfig = Record<string, ResolvedDatabaseConfiguration>;

/** Per-agent defaults, read via `agent.getAgentConfigSlice("database", ...)`. */
export const DatabaseAgentConfigSchema = z
  .object({
    datasource: z.string().exactOptional().meta({ description: "Datasource selected when the agent starts" }),
  })
  .prefault({});

// ─── Row browsing ─────────────────────────────────────────────────────────────
// Shared by the RPC endpoint and the database_selectRows tool so both accept
// exactly the same request shape.

export const FilterOperatorSchema = z.enum(filterOperators);

export const RowFilterSchema = z.object({
  column: z.string(),
  op: FilterOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))]).exactOptional(),
});

export const OrderBySchema = z.object({
  column: z.string(),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

/** Hard ceiling on rows per request, enforced in buildSelect regardless of caller. */
export const MAX_ROW_LIMIT = 1000;

export const SelectRowsRequestSchema = z.object({
  table: z.string(),
  columns: z.array(z.string()).exactOptional(),
  filters: z.array(RowFilterSchema).exactOptional(),
  orderBy: z.array(OrderBySchema).exactOptional(),
  limit: z.number().int().positive().max(MAX_ROW_LIMIT).default(100),
  offset: z.number().int().min(0).default(0),
});

// ─── Result shapes (shared with the RPC layer) ────────────────────────────────

export const TableRefSchema = z.object({
  name: z.string(),
  schema: z.string().exactOptional(),
  type: z.enum(["table", "view"]),
});

export const ColumnDefSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
  isPrimaryKey: z.boolean(),
  defaultValue: z.string().nullable(),
  comment: z.string().exactOptional(),
});

export const TableSchemaSchema = z.object({
  table: TableRefSchema,
  columns: z.array(ColumnDefSchema),
  primaryKey: z.array(z.string()),
  ddl: z.string().exactOptional(),
});

export const CellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const RowSchema = z.record(z.string(), CellValueSchema);
