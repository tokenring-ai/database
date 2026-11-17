import type { CellValue, ColumnDef } from "../types.ts";

/** A value as bound to a query parameter: what the RPC carries, plus BigInt for exact large integers. */
export type BoundValue = CellValue | bigint;

const integerTypePattern = /^(tinyint|smallint|mediumint|int|integer|bigint|serial|bigserial|smallserial|int2|int4|int8)\b/i;

/**
 * The parameter for `value` in `column`. Integers beyond 2^53 can't travel as JSON numbers, so the
 * browser sends them as exact digit strings; an integer column binds those as BigInt, which every
 * driver passes through exactly. (Bound as a string, MySQL would compare it as a double and match
 * the wrong row.)
 */
export function bindValueFor(column: ColumnDef | undefined, value: CellValue): BoundValue {
  if (typeof value === "string" && column && integerTypePattern.test(column.dataType) && /^[+-]?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return value;
}
