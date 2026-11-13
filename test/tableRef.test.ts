import { describe, expect, it } from "bun:test";
import { formatTableRef, parseTableRef } from "../util/tableRef.ts";

describe("formatTableRef / parseTableRef", () => {
  it("round-trips a schema and a name that contains a dot or a quote", () => {
    const samples = [
      { schema: "public", name: "users" },
      { schema: "analytics", name: "odd.name" },
      { schema: "my.schema", name: "my.table" },
      { schema: 'we"ird', name: "users" },
      { name: "odd.name" },
      { name: "users" },
    ];
    for (const table of samples) {
      expect(parseTableRef(formatTableRef(table))).toEqual({ schema: table.schema ?? null, name: table.name });
    }
    expect(formatTableRef({ schema: "analytics", name: "odd.name" })).toBe('analytics."odd.name"');
    expect(formatTableRef({ schema: "public", name: "users" })).toBe("public.users");
  });

  it("does not treat a dot inside a quoted name as the schema separator", () => {
    expect(parseTableRef('analytics."odd.name"')).toEqual({ schema: "analytics", name: "odd.name" });
    expect(parseTableRef('"odd.name"')).toEqual({ schema: null, name: "odd.name" });
    expect(parseTableRef('"my.schema"."my.table"')).toEqual({ schema: "my.schema", name: "my.table" });
  });

  it("keeps an unquoted single dot as the schema separator and a multi-dot string as a bare name", () => {
    expect(parseTableRef("analytics.users")).toEqual({ schema: "analytics", name: "users" });
    expect(parseTableRef("users")).toEqual({ schema: null, name: "users" });
    // Not a quoted ref: the extra dot is not a second separator we can place.
    expect(parseTableRef("analytics.odd.name")).toEqual({ schema: null, name: "analytics.odd.name" });
  });
});
