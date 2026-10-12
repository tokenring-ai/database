import { describe, expect, it } from "bun:test";
import { draftFromRow, draftToValues, rowEditBlockReason, rowKey } from "./rowEdit.ts";
import type { ColumnDef } from "./types.ts";

const columns: ColumnDef[] = [
  { name: "id", dataType: "int", nullable: false, isPrimaryKey: true, defaultValue: null },
  { name: "email", dataType: "varchar(255)", nullable: true, isPrimaryKey: false, defaultValue: null },
  { name: "created", dataType: "datetime", nullable: true, isPrimaryKey: false, defaultValue: null },
];

describe("rowEdit", () => {
  it("explains why rows cannot be edited", () => {
    expect(rowEditBlockReason(false, columns, ["id"])).toMatch(/read-only/);
    expect(rowEditBlockReason(true, columns, [])).toMatch(/no primary key/);
    expect(rowEditBlockReason(true, columns, ["created"])).toMatch(/cannot identify a row/);
    expect(rowEditBlockReason(true, columns, ["id"])).toBeNull();
  });

  it("sends only touched fields, NULL where chosen", () => {
    const draft = draftFromRow({ id: 1, email: "a@b.c", created: null }, columns);
    expect(draft.created).toEqual({ text: "", isNull: true, touched: false });
    expect(draftToValues(draft, columns).values).toEqual({});

    draft.email = { text: "", isNull: true, touched: true };
    draft.id = { text: "2", isNull: false, touched: true };
    expect(draftToValues(draft, columns)).toEqual({ values: { id: 2, email: null }, errors: {} });
  });

  it("rejects NULL for a NOT NULL column and blanks for numbers", () => {
    const draft = draftFromRow(null, columns);
    draft.id = { text: "", isNull: false, touched: true };
    expect(draftToValues(draft, columns).errors.id).toMatch(/Enter a number/);
    draft.id = { text: "", isNull: true, touched: true };
    expect(draftToValues(draft, columns).errors.id).toMatch(/cannot be NULL/);
  });

  it("builds the key from the primary key columns", () => {
    expect(rowKey({ id: 5, email: "x" }, ["id"])).toEqual({ id: 5 });
  });
});
