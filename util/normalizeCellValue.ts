import type { CellValue, Row } from "../types.ts";

/**
 * Coerces a driver-returned value into the {@link CellValue} contract
 * (`string | number | boolean | null`).
 *
 * Database drivers hand back richer types than the wire format allows: Bun's
 * MySQL client returns `Buffer` for TEXT/BLOB columns, `Date` for datetimes,
 * and `bigint` for large integers. Serializing those straight to the RPC layer
 * fails schema validation, so providers normalize here rather than letting a
 * `longtext` column take down the whole result set.
 */
export default function normalizeCellValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return value as CellValue;

  // Beyond Number.MAX_SAFE_INTEGER a bigint can't survive as a number, and
  // silently losing precision on an id column is worse than showing a string.
  if (type === "bigint") {
    const asBigInt = value as bigint;
    return asBigInt >= BigInt(Number.MIN_SAFE_INTEGER) && asBigInt <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(asBigInt) : asBigInt.toString();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (isBinary(value)) {
    return binaryToCell(value);
  }

  // JSON columns arrive already parsed on some drivers.
  if (type === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      // Rare circular / exotic objects; prefer a stable label over "[object Object]".
      return "[unserializable]";
    }
  }

  // Remaining typeof cases are symbol and function (neither is a normal cell value).
  if (type === "symbol") return (value as symbol).toString();
  if (type === "function") {
    const name = (value as { name?: string }).name;
    return name ? `[Function ${name}]` : "[Function]";
  }

  return null;
}

function isBinary(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(value));
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * TEXT columns come back as bytes that are really UTF-8 text; genuine BLOBs
 * don't. Decoding strictly tells the two apart — invalid UTF-8 means binary,
 * which becomes base64 rather than replacement-character soup.
 */
function binaryToCell(bytes: Uint8Array): string {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return Buffer.from(bytes).toString("base64");
  }
}

/** Normalizes every cell of one row. */
export function normalizeRow(row: Record<string, unknown>): Row {
  const out: Row = {};
  for (const key of Object.keys(row)) {
    out[key] = normalizeCellValue(row[key]);
  }
  return out;
}

/** Normalizes every cell of every row. */
export function normalizeRows(rows: Iterable<Record<string, unknown>>): Row[] {
  return [...rows].map(normalizeRow);
}

/** Reads a driver-returned scalar as a number, tolerating bigint/string/Buffer counts. */
export function normalizeCount(value: unknown): number | null {
  const normalized = normalizeCellValue(value);
  if (normalized === null || typeof normalized === "boolean") return null;
  const asNumber = Number(normalized);
  return Number.isFinite(asNumber) ? asNumber : null;
}
