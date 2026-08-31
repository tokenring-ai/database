/**
 * Whether a statement only reads.
 *
 * Naive prefix matching gets this wrong in both directions: a lowercase
 * `select`, a leading comment, or a `WITH … SELECT` all read but don't start
 * with `SELECT`. Comments are stripped first so `/* x *\/ DELETE …` can't
 * masquerade as a read.
 */
const readOnlyLeadingKeywords = ["select", "show", "describe", "desc", "explain", "with"];

export function stripLeadingComments(sql: string): string {
  let rest = sql.trim();
  let changed = true;

  while (changed) {
    changed = false;
    if (rest.startsWith("--") || rest.startsWith("#")) {
      const newline = rest.indexOf("\n");
      rest = newline === -1 ? "" : rest.slice(newline + 1).trimStart();
      changed = true;
    } else if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      rest = end === -1 ? "" : rest.slice(end + 2).trimStart();
      changed = true;
    }
  }

  return rest;
}

/**
 * Splits on `;` that are not inside a string, quoted identifier, comment, or
 * Postgres dollar-quote. A trailing semicolon does not produce an extra piece.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) statements.push(trimmed);
    current = "";
  };

  while (i < sql.length) {
    const char = sql[i]!;
    const next = sql[i + 1];

    if ((char === "-" && next === "-") || char === "#") {
      const newline = sql.indexOf("\n", i);
      i = newline === -1 ? sql.length : newline;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      const closed = readQuoted(sql, i);
      current += sql.slice(i, closed);
      i = closed;
      continue;
    }

    if (char === "$") {
      const dollarEnd = readDollarQuote(sql, i);
      if (dollarEnd !== null) {
        current += sql.slice(i, dollarEnd);
        i = dollarEnd;
        continue;
      }
    }

    if (char === ";") {
      pushCurrent();
      i++;
      continue;
    }

    current += char;
    i++;
  }

  pushCurrent();
  return statements;
}

function readQuoted(sql: string, start: number): number {
  const quote = sql[start]!;
  let i = start + 1;
  while (i < sql.length) {
    const char = sql[i]!;
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return sql.length;
}

/** Postgres `$tag$...$tag$`. Returns the index after the closer, or null if this `$` is not a delimiter. */
function readDollarQuote(sql: string, start: number): number | null {
  const open = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(start));
  if (!open) return null;
  const delimiter = open[0];
  const close = sql.indexOf(delimiter, start + delimiter.length);
  return close === -1 ? sql.length : close + delimiter.length;
}

function isReadOnlyStatement(sql: string): boolean {
  const statement = stripLeadingComments(sql).toLowerCase();
  if (statement === "") return false;

  const keyword = statement.match(/^[a-z]+/)?.[0];
  if (!keyword || !readOnlyLeadingKeywords.includes(keyword)) return false;

  // A CTE reads only if what it feeds is also a read — `WITH x AS (...) DELETE`
  // is valid in several dialects.
  if (keyword === "with") {
    return !/\b(insert|update|delete|replace|merge|drop|alter|create|truncate|grant|revoke)\b/.test(statement);
  }

  return true;
}

export default function isReadOnlyQuery(sql: string): boolean {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) return false;
  return statements.every(isReadOnlyStatement);
}
