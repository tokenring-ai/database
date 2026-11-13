const SIMPLE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Encodes a table so it can travel through one string (the table URL segment
 * and `resolveTable`). A `.` inside a quoted identifier is not a schema separator.
 * Simple identifiers stay bare: `public.users`. Anything else is double-quoted,
 * with embedded quotes doubled: `analytics."odd.name"`.
 */
export function formatTableRef(table: { schema?: string | null; name: string }): string {
  if (!table.schema) return quoteTableIdent(table.name);
  return `${quoteTableIdent(table.schema)}.${quoteTableIdent(table.name)}`;
}

/** Inverse of {@link formatTableRef}. A ref that does not split cleanly stays a bare name. */
export function parseTableRef(table: string): { schema: string | null; name: string } {
  const parts = splitTableRef(table);
  if (parts?.length === 2) return { schema: parts[0]!, name: parts[1]! };
  if (parts?.length === 1) return { schema: null, name: parts[0]! };
  return { schema: null, name: table };
}

function quoteTableIdent(name: string): string {
  if (SIMPLE_IDENT.test(name)) return name;
  return `"${name.replaceAll('"', '""')}"`;
}

/** Splits `schema.table`, honoring double quotes. Null when the string is not one or more identifiers. */
function splitTableRef(input: string): string[] | null {
  const parts: string[] = [];
  const length = input.length;
  let index = 0;

  while (index < length) {
    if (input[index] === '"') {
      let value = "";
      index += 1;
      let closed = false;
      while (index < length) {
        if (input[index] === '"') {
          if (input[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += input[index];
        index += 1;
      }
      if (!closed) return null;
      parts.push(value);
    } else {
      const start = index;
      while (index < length && input[index] !== ".") index += 1;
      if (index === start) return null;
      parts.push(input.slice(start, index));
    }

    if (index === length) return parts;
    if (input[index] !== ".") return null;
    index += 1;
    if (index === length) return null;
  }

  return parts;
}
