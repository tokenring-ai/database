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

  it("rejects a write hidden after a leading read", () => {
    expect(isReadOnlyQuery("SELECT 1; DROP TABLE users")).toBe(false);
    expect(isReadOnlyQuery("SELECT 1; DELETE FROM users")).toBe(false);
    expect(isReadOnlyQuery("SHOW TABLES; TRUNCATE users")).toBe(false);
  });

  it("still accepts a single read with a trailing semicolon", () => {
    expect(isReadOnlyQuery("SELECT 1;")).toBe(true);
    expect(isReadOnlyQuery("SELECT 1;   ")).toBe(true);
  });

  it("accepts multiple read-only statements", () => {
    expect(isReadOnlyQuery("SELECT 1; SELECT 2")).toBe(true);
    expect(isReadOnlyQuery("SHOW TABLES; DESCRIBE users")).toBe(true);
  });

  it("does not treat a semicolon inside a string or comment as a statement break", () => {
    expect(isReadOnlyQuery("SELECT 'foo; DROP TABLE users'")).toBe(true);
    expect(isReadOnlyQuery("SELECT 1 /* ; DROP TABLE users */")).toBe(true);
    expect(isReadOnlyQuery("SELECT 1 -- ; DROP TABLE users")).toBe(true);
  });

  it("rejects a write after a commented-out semicolon", () => {
    expect(isReadOnlyQuery("SELECT 1; -- note\nDROP TABLE users")).toBe(false);
  });
});

describe("isReadOnlyQuery write detection inside reads", () => {
  it("rejects EXPLAIN ANALYZE of a write, which really executes it", () => {
    expect(isReadOnlyQuery("EXPLAIN ANALYZE DELETE FROM users")).toBe(false);
    expect(isReadOnlyQuery("explain update users set name = 'x'")).toBe(false);
    expect(isReadOnlyQuery("EXPLAIN ANALYZE SELECT * FROM users")).toBe(true);
  });

  it("rejects SELECT … INTO, which creates a table or writes a file", () => {
    expect(isReadOnlyQuery("SELECT * INTO backup FROM users")).toBe(false);
    expect(isReadOnlyQuery("SELECT * FROM users INTO OUTFILE '/tmp/x'")).toBe(false);
  });

  it("ignores write keywords inside string literals and quoted identifiers", () => {
    expect(isReadOnlyQuery("SELECT 'insert into users' AS hint")).toBe(true);
    expect(isReadOnlyQuery('SELECT "update" FROM audit')).toBe(true);
    expect(isReadOnlyQuery("WITH x AS (SELECT 'delete' AS word) SELECT * FROM x")).toBe(true);
  });
});

describe("isReadOnlyQuery plain SELECT", () => {
  it("keeps the replace() function and column names that contain keywords readable", () => {
    expect(isReadOnlyQuery("SELECT replace(name, 'a', 'b'), updated_at FROM users")).toBe(true);
  });
});

describe("isReadOnlyQuery across dialects", () => {
  it("catches a write hidden behind a backslash that only MySQL treats as an escape", () => {
    expect(isReadOnlyQuery("SELECT 'x\\'; DELETE FROM t; --'")).toBe(false);
  });

  it("catches a write hidden behind # that only MySQL treats as a comment", () => {
    // In Postgres `#` is bitwise XOR, so this is two statements there.
    expect(isReadOnlyQuery("SELECT 1 # 2; DROP TABLE users")).toBe(false);
  });

  it("catches a write after -- with no space, which MySQL does not treat as a comment", () => {
    expect(isReadOnlyQuery("SELECT 1 --; DROP TABLE users")).toBe(false);
  });

  it("still reads ordinary queries with these characters as reads", () => {
    expect(isReadOnlyQuery("SELECT 'it''s fine' -- trailing note")).toBe(true);
    expect(isReadOnlyQuery("SELECT 'C:\\path' AS p")).toBe(true);
    expect(isReadOnlyQuery("SELECT 1 # 2")).toBe(true);
  });
});
