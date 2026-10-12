import type { RPCSchema } from "@tokenring-ai/rpc/types";
import { AgentNotFoundSchema, SuccessSchema } from "@tokenring-ai/rpc/types";
import { z } from "zod";
import { CellValueSchema, MAX_ROW_LIMIT, OrderBySchema, RowFilterSchema, RowSchema, TableRefSchema, TableSchemaSchema } from "../schema.ts";

const RowValuesSchema = z.record(z.string(), CellValueSchema);
const MutationTargetSchema = { datasource: z.string(), table: z.string() };

/** Everything an agent-scoped call reports back about the current selection. */
const DatabaseStateResultSchema = {
  activeDatasource: z.string().nullable(),
  activeTable: z.string().nullable(),
  activeTableSchema: TableSchemaSchema.nullable(),
  selectedRowCount: z.number(),
  availableDatasources: z.array(z.string()),
};

export default {
  name: "Database RPC",
  path: "/rpc/database",
  methods: {
    getDatabaseConfiguration: {
      type: "query",
      input: z.object({}),
      // Names and flags only — the connection string never leaves the server.
      result: z.object({
        datasources: z.array(
          z.object({
            name: z.string(),
            scheme: z.string(),
            allowWrites: z.boolean(),
            /** "missingSecret": configured, but its connection-string secret has no value, so it cannot connect. */
            status: z.enum(["ready", "missingSecret"]),
          }),
        ),
        agentTypes: z.array(z.string()),
      }),
    },
    testConnection: {
      type: "mutation",
      input: z.object({
        datasource: z.string(),
        /**
         * Dry run: test this connection string instead of the configured
         * datasource's, without registering it (the name is only used in errors).
         */
        url: z.string().exactOptional(),
      }),
      result: z.object({
        ok: z.boolean(),
        tableCount: z.number().exactOptional(),
        error: z.string().exactOptional(),
      }),
    },
    listTables: {
      type: "query",
      input: z.object({
        datasource: z.string(),
      }),
      result: z.object({
        tables: z.array(TableRefSchema),
      }),
    },
    getTableSchema: {
      type: "query",
      input: z.object({
        datasource: z.string(),
        table: z.string(),
      }),
      result: z.object({
        schema: TableSchemaSchema,
      }),
    },
    selectRows: {
      type: "query",
      input: z.object({
        datasource: z.string(),
        table: z.string(),
        columns: z.array(z.string()).exactOptional(),
        filters: z.array(RowFilterSchema).exactOptional(),
        orderBy: z.array(OrderBySchema).exactOptional(),
        limit: z.number().int().positive().max(1000).exactOptional(),
        offset: z.number().int().min(0).exactOptional(),
      }),
      result: z.object({
        rows: z.array(RowSchema),
        fields: z.array(z.string()),
        totalCount: z.number().nullable(),
        hasMore: z.boolean(),
      }),
    },
    /**
     * Runs one user-typed SQL statement (the Query view). Non-read statements are
     * refused on read-only datasources and otherwise need `confirmWrite: true`;
     * without it nothing runs and `confirmationRequired` comes back. Rows are
     * capped at `maxRows` (≤ MAX_ROW_LIMIT).
     */
    executeSql: {
      type: "mutation",
      input: z.object({
        datasource: z.string(),
        sql: z.string().min(1),
        confirmWrite: z.boolean().exactOptional(),
        maxRows: z.number().int().positive().max(MAX_ROW_LIMIT).exactOptional(),
      }),
      result: z.discriminatedUnion("status", [
        z.object({
          status: z.literal("success"),
          rows: z.array(RowSchema),
          fields: z.array(z.string()),
          rowCount: z.number(),
          truncated: z.boolean(),
          affectedRows: z.number().nullable(),
          elapsedMs: z.number(),
          readOnly: z.boolean(),
        }),
        z.object({ status: z.literal("confirmationRequired"), message: z.string() }),
        z.object({ status: z.literal("writeRefused"), message: z.string() }),
        z.object({ status: z.literal("error"), error: z.string(), elapsedMs: z.number() }),
      ]),
    },
    /** `CREATE TABLE` (or equivalent) text for every table and view, keyed by name. */
    showSchema: {
      type: "query",
      input: z.object({
        datasource: z.string(),
      }),
      result: z.object({
        schema: z.record(z.string(), z.string()),
      }),
    },
    /**
     * Inserts one row, or updates/deletes the one row named by its full primary
     * key, with bound parameters (util/buildMutation.ts). Refused on read-only
     * datasources; `unsupported` when the provider has no row editing.
     */
    mutateRow: {
      type: "mutation",
      input: z.discriminatedUnion("kind", [
        z.object({ ...MutationTargetSchema, kind: z.literal("insert"), values: RowValuesSchema }),
        z.object({ ...MutationTargetSchema, kind: z.literal("update"), key: RowValuesSchema, values: RowValuesSchema }),
        z.object({ ...MutationTargetSchema, kind: z.literal("delete"), key: RowValuesSchema }),
      ]),
      result: z.discriminatedUnion("status", [
        z.object({ status: z.literal("success"), affectedRows: z.number().nullable() }),
        z.object({ status: z.literal("writeRefused"), message: z.string() }),
        z.object({ status: z.literal("unsupported"), message: z.string() }),
        z.object({ status: z.literal("error"), error: z.string() }),
      ]),
    },
    getDatabaseState: {
      type: "query",
      input: z.object({
        agentId: z.string(),
      }),
      result: z.discriminatedUnion("status", [SuccessSchema.extend(DatabaseStateResultSchema), AgentNotFoundSchema]),
    },
    updateDatabaseState: {
      type: "mutation",
      input: z.object({
        agentId: z.string(),
        datasource: z.string().exactOptional(),
        table: z.string().exactOptional(),
        selectedRows: z.array(RowSchema).exactOptional(),
      }),
      result: z.discriminatedUnion("status", [SuccessSchema.extend(DatabaseStateResultSchema), AgentNotFoundSchema]),
    },
  },
} satisfies RPCSchema;
