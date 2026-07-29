import { describe, expect, it } from "bun:test";
import normalizeCellValue, { normalizeCount, normalizeRow, normalizeRows } from "../util/normalizeCellValue.ts";

describe("normalizeCellValue", () => {
  it("passes JSON primitives through untouched", () => {
    expect(normalizeCellValue("hello")).toBe("hello");
    expect(normalizeCellValue(42)).toBe(42);
    expect(normalizeCellValue(0)).toBe(0);
    expect(normalizeCellValue("")).toBe("");
    expect(normalizeCellValue(true)).toBe(true);
    expect(normalizeCellValue(false)).toBe(false);
  });

  it("maps null and undefined to null", () => {
    expect(normalizeCellValue(null)).toBe(null);
    expect(normalizeCellValue(undefined)).toBe(null);
  });

  it("decodes a UTF-8 text Buffer to a string", () => {
    // This is the case that broke the app: longtext columns arrive as Buffers.
    expect(normalizeCellValue(Buffer.from("mysql_native_password", "utf8"))).toBe("mysql_native_password");
    expect(normalizeCellValue(Buffer.from("café ☕", "utf8"))).toBe("café ☕");
    expect(normalizeCellValue(Buffer.from("", "utf8"))).toBe("");
  });

  it("decodes a Uint8Array the same way", () => {
    expect(normalizeCellValue(new TextEncoder().encode("hello"))).toBe("hello");
  });

  it("base64-encodes bytes that are not valid UTF-8", () => {
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
    expect(normalizeCellValue(binary)).toBe(binary.toString("base64"));
  });

  it("converts a Date to an ISO string", () => {
    expect(normalizeCellValue(new Date("2024-01-02T03:04:05.000Z"))).toBe("2024-01-02T03:04:05.000Z");
  });

  it("maps an invalid Date to null", () => {
    expect(normalizeCellValue(new Date("nonsense"))).toBe(null);
  });

  it("converts a safe bigint to a number", () => {
    expect(normalizeCellValue(123n)).toBe(123);
    expect(normalizeCellValue(-123n)).toBe(-123);
  });

  it("keeps an unsafe bigint as a string rather than losing precision", () => {
    const huge = 9007199254740993n; // Number.MAX_SAFE_INTEGER + 2
    expect(normalizeCellValue(huge)).toBe("9007199254740993");
  });

  it("serializes an object (e.g. a parsed JSON column)", () => {
    expect(normalizeCellValue({ a: 1 })).toBe('{"a":1}');
    expect(normalizeCellValue([1, 2])).toBe("[1,2]");
  });

  it("never returns a value outside the CellValue contract", () => {
    const inputs: unknown[] = [Buffer.from("x"), new Date(), 1n, { a: 1 }, [1], null, undefined, "s", 1, true];
    for (const input of inputs) {
      const result = normalizeCellValue(input);
      const type = typeof result;
      expect(result === null || type === "string" || type === "number" || type === "boolean").toBe(true);
    }
  });
});

describe("normalizeRow / normalizeRows", () => {
  it("normalizes every cell of a row", () => {
    expect(normalizeRow({ id: 1n, name: Buffer.from("ana"), seen: new Date("2024-01-01T00:00:00.000Z"), gone: null })).toEqual({
      id: 1,
      name: "ana",
      seen: "2024-01-01T00:00:00.000Z",
      gone: null,
    });
  });

  it("preserves column order and count", () => {
    const rows = normalizeRows([{ a: Buffer.from("1"), b: 2 }]);
    expect(Object.keys(rows[0]!)).toEqual(["a", "b"]);
  });

  it("handles an empty result set", () => {
    expect(normalizeRows([])).toEqual([]);
  });
});

describe("normalizeCount", () => {
  it("reads numbers, bigints, strings and Buffers", () => {
    expect(normalizeCount(4)).toBe(4);
    expect(normalizeCount(4n)).toBe(4);
    expect(normalizeCount("4")).toBe(4);
    expect(normalizeCount(Buffer.from("4"))).toBe(4);
  });

  it("returns null when there is no usable count", () => {
    expect(normalizeCount(undefined)).toBe(null);
    expect(normalizeCount(null)).toBe(null);
    expect(normalizeCount("not a number")).toBe(null);
  });
});
