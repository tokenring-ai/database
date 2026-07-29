import { describe, expect, it } from "bun:test";
import isReadOnlyQuery from "../util/isReadOnlyQuery.ts";

describe("isReadOnlyQuery", () => {
  it("accepts SELECT regardless of case", () => {
    expect(isReadOnlyQuery("SELECT * FROM users")).toBe(true);
    expect(isReadOnlyQuery("select * from users")).toBe(true);
    expect(isReadOnlyQuery("  \n SeLeCt 1")).toBe(true);
  });

  it("accepts other read-only statements", () => {
    expect(isReadOnlyQuery("SHOW TABLES")).toBe(true);
    expect(isReadOnlyQuery("DESCRIBE users")).toBe(true);
    expect(isReadOnlyQuery("EXPLAIN SELECT 1")).toBe(true);
  });

  it("accepts a read-only CTE", () => {
    expect(isReadOnlyQuery("WITH recent AS (SELECT * FROM users) SELECT * FROM recent")).toBe(true);
  });

  it("rejects a CTE that writes", () => {
    expect(isReadOnlyQuery("WITH doomed AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM doomed)")).toBe(false);
  });

  it("sees through leading comments", () => {
    expect(isReadOnlyQuery("/* nightly */ SELECT 1")).toBe(true);
    expect(isReadOnlyQuery("-- harmless\nSELECT 1")).toBe(true);
    // The comment must not let a write masquerade as a read.
    expect(isReadOnlyQuery("/* SELECT */ DELETE FROM users")).toBe(false);
    expect(isReadOnlyQuery("-- SELECT\nDROP TABLE users")).toBe(false);
  });

  it("rejects writes", () => {
    expect(isReadOnlyQuery("UPDATE users SET name = 'x'")).toBe(false);
    expect(isReadOnlyQuery("delete from users")).toBe(false);
    expect(isReadOnlyQuery("INSERT INTO users VALUES (1)")).toBe(false);
    expect(isReadOnlyQuery("TRUNCATE users")).toBe(false);
    expect(isReadOnlyQuery("DROP TABLE users")).toBe(false);
  });

  it("rejects an empty or comment-only statement", () => {
    expect(isReadOnlyQuery("")).toBe(false);
    expect(isReadOnlyQuery("   ")).toBe(false);
    expect(isReadOnlyQuery("-- nothing here")).toBe(false);
  });

  it("does not treat a word merely starting with a keyword as that keyword", () => {
    expect(isReadOnlyQuery("selectify()")).toBe(false);
  });
});
