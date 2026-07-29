import { describe, expect, it } from "bun:test";
import { MAX_ROW_LIMIT } from "../schema.ts";
import type { ColumnDef, SelectRowsRequest } from "../types.ts";
import buildSelect, { InvalidSelectRequestError } from "../util/buildSelect.ts";

const columns: ColumnDef[] = [
  { name: "id", dataType: "int", nullable: false, isPrimaryKey: true, defaultValue: null },
  { name: "email", dataType: "varchar(255)", nullable: false, isPrimaryKey: false, defaultValue: null },
  { name: "deleted_at", dataType: "datetime", nullable: true, isPrimaryKey: false, defaultValue: null },
];

function request(overrides: Partial<SelectRowsRequest> = {}): SelectRowsRequest {
  return { table: "users", limit: 100, offset: 0, ...overrides };
}

describe("buildSelect", () => {
  it("selects every column when none are requested", () => {
    const built = buildSelect(request(), columns);
    expect(built.sql).toBe("SELECT `id`, `email`, `deleted_at` FROM `users` LIMIT ? OFFSET ?");
    expect(built.params).toEqual([100, 0]);
    expect(built.fields).toEqual(["id", "email", "deleted_at"]);
  });

  it("restricts to the requested columns, in the requested order", () => {
    const built = buildSelect(request({ columns: ["email", "id"] }), columns);
    expect(built.sql).toStartWith("SELECT `email`, `id` FROM `users`");
    expect(built.fields).toEqual(["email", "id"]);
  });

  it("rejects an unknown column", () => {
    expect(() => buildSelect(request({ columns: ["password_hash"] }), columns)).toThrow(InvalidSelectRequestError);
  });

  it("rejects an unknown filter column", () => {
    expect(() => buildSelect(request({ filters: [{ column: "nope", op: "eq", value: 1 }] }), columns)).toThrow(InvalidSelectRequestError);
  });

  it("rejects an unknown sort column", () => {
    expect(() => buildSelect(request({ orderBy: [{ column: "nope", direction: "asc" }] }), columns)).toThrow(InvalidSelectRequestError);
  });

  it("binds filter values as parameters rather than inlining them", () => {
    const built = buildSelect(request({ filters: [{ column: "email", op: "eq", value: "1; DROP TABLE users --" }] }), columns);
    expect(built.sql).toBe("SELECT `id`, `email`, `deleted_at` FROM `users` WHERE `email` = ? LIMIT ? OFFSET ?");
    expect(built.params).toEqual(["1; DROP TABLE users --", 100, 0]);
    expect(built.sql).not.toInclude("DROP");
  });

  it("combines multiple filters with AND", () => {
    const built = buildSelect(
      request({
        filters: [
          { column: "email", op: "like", value: "%@example.com" },
          { column: "id", op: "gte", value: 10 },
        ],
      }),
      columns,
    );
    expect(built.sql).toInclude("WHERE `email` LIKE ? AND `id` >= ?");
    expect(built.params).toEqual(["%@example.com", 10, 100, 0]);
  });

  it("emits IS NULL / IS NOT NULL without a parameter", () => {
    const built = buildSelect(request({ filters: [{ column: "deleted_at", op: "isNull" }] }), columns);
    expect(built.sql).toInclude("WHERE `deleted_at` IS NULL");
    expect(built.params).toEqual([100, 0]);
  });

  it("expands `in` to one placeholder per value", () => {
    const built = buildSelect(request({ filters: [{ column: "id", op: "in", value: [1, 2, 3] }] }), columns);
    expect(built.sql).toInclude("WHERE `id` IN (?, ?, ?)");
    expect(built.params).toEqual([1, 2, 3, 100, 0]);
  });

  it("turns an empty `in` list into a never-matching condition", () => {
    const built = buildSelect(request({ filters: [{ column: "id", op: "in", value: [] }] }), columns);
    expect(built.sql).toInclude("WHERE 1 = 0");
    expect(built.params).toEqual([100, 0]);
  });

  it("rejects a comparison filter with no value", () => {
    expect(() => buildSelect(request({ filters: [{ column: "id", op: "eq" }] }), columns)).toThrow(InvalidSelectRequestError);
  });

  it("rejects a list value on a scalar operator", () => {
    expect(() => buildSelect(request({ filters: [{ column: "id", op: "eq", value: [1, 2] }] }), columns)).toThrow(InvalidSelectRequestError);
  });

  it("orders by multiple columns", () => {
    const built = buildSelect(
      request({
        orderBy: [
          { column: "email", direction: "asc" },
          { column: "id", direction: "desc" },
        ],
      }),
      columns,
    );
    expect(built.sql).toInclude("ORDER BY `email` ASC, `id` DESC");
  });

  it("clamps the limit to MAX_ROW_LIMIT", () => {
    const built = buildSelect(request({ limit: 999_999 }), columns);
    expect(built.limit).toBe(MAX_ROW_LIMIT);
    expect(built.params).toEqual([MAX_ROW_LIMIT, 0]);
  });

  it("floors a negative offset to zero", () => {
    const built = buildSelect(request({ offset: -5 }), columns);
    expect(built.offset).toBe(0);
  });

  it("pages with offset", () => {
    const built = buildSelect(request({ limit: 25, offset: 50 }), columns);
    expect(built.params).toEqual([25, 50]);
  });

  it("builds a count query with the same filters but no paging", () => {
    const built = buildSelect(request({ filters: [{ column: "id", op: "gt", value: 5 }], limit: 10, offset: 20 }), columns);
    expect(built.countSql).toBe("SELECT COUNT(*) AS total FROM `users` WHERE `id` > ?");
    expect(built.countParams).toEqual([5]);
  });

  it("rejects a table with no columns", () => {
    expect(() => buildSelect(request(), [])).toThrow(InvalidSelectRequestError);
  });
});
