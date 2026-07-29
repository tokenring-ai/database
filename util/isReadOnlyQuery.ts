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

export default function isReadOnlyQuery(sql: string): boolean {
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
