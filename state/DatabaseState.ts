import type { Agent } from "@tokenring-ai/agent";
import { AgentStateSlice } from "@tokenring-ai/agent/types";
import deepClone from "@tokenring-ai/utility/object/deepClone";
import { z } from "zod";
import { type DatabaseAgentConfigSchema, RowSchema, TableSchemaSchema } from "../schema.ts";
import type { Row, TableSchema } from "../types.ts";

const serializationSchema = z
  .object({
    activeDatasource: z.string().optional(),
    activeTable: z.string().optional(),
    activeTableSchema: TableSchemaSchema.optional(),
    selectedRows: z.array(RowSchema).optional(),
    lastAttachedSchemaKey: z.string().optional(),
    lastAttachedSelectionKey: z.string().optional(),
  })
  .prefault({});

export class DatabaseState extends AgentStateSlice<typeof serializationSchema> {
  activeDatasource: string | undefined;
  activeTable: string | undefined;
  activeTableSchema: TableSchema | undefined;
  selectedRows: Row[] = [];
  /** `${datasource}:${table}` of the schema last attached to a chat message. */
  lastAttachedSchemaKey: string | undefined;
  /** `${datasource}:${table}:${fingerprint}` of the rows last attached. */
  lastAttachedSelectionKey: string | undefined;

  constructor(readonly initialConfig: z.output<typeof DatabaseAgentConfigSchema>) {
    super("DatabaseState", serializationSchema);
    this.activeDatasource = initialConfig.datasource;
  }

  transferStateFromParent(parent: Agent): void {
    const parentState = parent.getState(DatabaseState);
    this.activeDatasource ??= parentState.activeDatasource;
    this.activeTable ??= parentState.activeTable;
    this.activeTableSchema ??= deepClone(parentState.activeTableSchema);
  }

  serialize(): z.output<typeof serializationSchema> {
    return {
      activeDatasource: this.activeDatasource,
      activeTable: this.activeTable,
      activeTableSchema: this.activeTableSchema,
      selectedRows: this.selectedRows,
      lastAttachedSchemaKey: this.lastAttachedSchemaKey,
      lastAttachedSelectionKey: this.lastAttachedSelectionKey,
    };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    this.activeDatasource = data.activeDatasource;
    this.activeTable = data.activeTable;
    this.activeTableSchema = data.activeTableSchema;
    this.selectedRows = data.selectedRows ?? [];
    this.lastAttachedSchemaKey = data.lastAttachedSchemaKey;
    this.lastAttachedSelectionKey = data.lastAttachedSelectionKey;
  }

  show(): string {
    return `Active Datasource: ${this.activeDatasource ?? "None"}
    Active Table: ${this.activeTable ?? "None"}
    Columns: ${this.activeTableSchema ? this.activeTableSchema.columns.map(c => c.name).join(", ") : "Unknown"}
    Selected Rows: ${this.selectedRows.length}`;
  }
}
