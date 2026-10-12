import { describe, expect, it } from "bun:test";
import type { TableSchema } from "../types.ts";
import buildMutation, { InvalidMutationError } from "../util/buildMutation.ts";
import { dollarPlaceholder, doubleQuoteIdentifier } from "../util/buildSelect.ts";

const schema: TableSchema = {
  table: { name: "users", type: "table" },
  columns: [
    { name: "id", dataType: "int", nullable: false, isPrimaryKey: true, defaultValue: null },
    { name: "email", dataType: "varchar(255)", nullable: false, isPrimaryKey: false, defaultValue: null },
    { name: "bio", dataType: "text", nullable: true, isPrimaryKey: false, defaultValue: null },
    { name: "avatar", dataType: "blob", nullable: true, isPrimaryKey: false, defaultValue: null },
  ],
  primaryKey: ["id"],
};

describe("buildMutation", () => {
  it("binds every insert value", () => {
    expect(buildMutation({ kind: "insert", table: "users", values: { email: "a@b.c", bio: null } }, schema)).toEqual({
      sql: "INSERT INTO `users` (`email`, `bio`) VALUES (?, ?)",
      params: ["a@b.c", null],
    });
  });

  it("updates one row by its primary key, numbering Postgres placeholders across SET and WHERE", () => {
    const built = buildMutation({ kind: "update", table: "users", key: { id: 7 }, values: { email: "x'; DROP TABLE users; --", bio: "hi" } }, schema, {
      quoteIdentifier: doubleQuoteIdentifier,
      parameterPlaceholder: dollarPlaceholder,
    });
    expect(built.sql).toBe('UPDATE "users" SET "email" = $1, "bio" = $2 WHERE "id" = $3');
    expect(built.params).toEqual(["x'; DROP TABLE users; --", "hi", 7]);
  });

  it("deletes one row by its primary key", () => {
    expect(buildMutation({ kind: "delete", table: "users", key: { id: 7 } }, schema)).toEqual({ sql: "DELETE FROM `users` WHERE `id` = ?", params: [7] });
  });

  it("rejects unknown columns instead of escaping them", () => {
    expect(() => buildMutation({ kind: "insert", table: "users", values: { "email`; DROP TABLE users; --": "x" } }, schema)).toThrow(InvalidMutationError);
  });

  it("requires exactly the primary key with a value", () => {
    expect(() => buildMutation({ kind: "delete", table: "users", key: {} }, schema)).toThrow(/exactly the primary key/);
    expect(() => buildMutation({ kind: "delete", table: "users", key: { email: "a@b.c" } }, schema)).toThrow(/exactly the primary key/);
    expect(() => buildMutation({ kind: "delete", table: "users", key: { id: 1, email: "a@b.c" } }, schema)).toThrow(/exactly the primary key/);
    expect(() => buildMutation({ kind: "delete", table: "users", key: { id: null } }, schema)).toThrow(/has no value/);
  });

  it("refuses update and delete on a table without a primary key", () => {
    const keyless = { ...schema, primaryKey: [], columns: schema.columns.map(column => ({ ...column, isPrimaryKey: false })) };
    expect(() => buildMutation({ kind: "delete", table: "users", key: { id: 1 } }, keyless)).toThrow(/no primary key/);
    // Inserting needs no key.
    expect(buildMutation({ kind: "insert", table: "users", values: { id: 1 } }, keyless).sql).toBe("INSERT INTO `users` (`id`) VALUES (?)");
  });

  it("refuses to write values into lossy column types, but allows NULL", () => {
    expect(() => buildMutation({ kind: "update", table: "users", key: { id: 1 }, values: { avatar: "AAAA" } }, schema)).toThrow(/cannot be edited/);
    expect(buildMutation({ kind: "update", table: "users", key: { id: 1 }, values: { avatar: null } }, schema).params).toEqual([null, 1]);
  });

  it("refuses a primary key whose type does not round-trip", () => {
    const dated = { ...schema, columns: [{ ...schema.columns[0]!, name: "day", dataType: "date" }], primaryKey: ["day"] };
    expect(() => buildMutation({ kind: "delete", table: "users", key: { day: "2024-01-01T00:00:00.000Z" } }, dated)).toThrow(/cannot identify a row/);
  });

  it("requires at least one value", () => {
    expect(() => buildMutation({ kind: "update", table: "users", key: { id: 1 }, values: {} }, schema)).toThrow(/No column values/);
  });
});
