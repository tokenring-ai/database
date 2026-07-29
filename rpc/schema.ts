import type { RPCSchema } from "@tokenring-ai/rpc/types";
import { AgentNotFoundSchema, SuccessSchema } from "@tokenring-ai/rpc/types";
import { z } from "zod";
import { OrderBySchema, RowFilterSchema, RowSchema, TableRefSchema, TableSchemaSchema } from "../schema.ts";

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
    getDatasources: {
      type: "query",
      input: z.object({}),
      // Names and flags only — the connection string never leaves the server.
      result: z.object({
        datasources: z.array(
          z.object({
            name: z.string(),
            scheme: z.string(),
            allowWrites: z.boolean(),
          }),
        ),
      }),
    },
    testConnection: {
      type: "mutation",
      input: z.object({
        datasource: z.string(),
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
