import { describe, expect, it } from "bun:test";
import { addHistoryEntry, clearHistory, historyFor, type QueryHistoryEntry, removeHistoryEntry } from "./queryHistory.ts";

const entry = (id: string, sql: string): QueryHistoryEntry => ({ id, sql, ranAt: 1, status: "success", rowCount: 0, elapsedMs: 1 });

describe("query history", () => {
  it("puts the newest entry first and keeps datasources apart", () => {
    let history = addHistoryEntry({}, "a", entry("1", "SELECT 1"));
    history = addHistoryEntry(history, "a", entry("2", "SELECT 2"));
    history = addHistoryEntry(history, "b", entry("3", "SELECT 3"));
    expect(historyFor(history, "a").map(e => e.id)).toEqual(["2", "1"]);
    expect(historyFor(history, "b").map(e => e.id)).toEqual(["3"]);
  });

  it("moves a re-run statement to the top instead of duplicating it", () => {
    let history = addHistoryEntry({}, "a", entry("1", "SELECT 1"));
    history = addHistoryEntry(history, "a", entry("2", "SELECT 2"));
    history = addHistoryEntry(history, "a", entry("3", "  SELECT 1 "));
    expect(historyFor(history, "a").map(e => e.id)).toEqual(["3", "2"]);
  });

  it("caps each datasource's history, dropping the oldest", () => {
    let history = {};
    for (let i = 0; i < 5; i++) history = addHistoryEntry(history, "a", entry(String(i), `SELECT ${i}`), 3);
    expect(historyFor(history, "a").map(e => e.id)).toEqual(["4", "3", "2"]);
  });

  it("removes and clears entries", () => {
    let history = addHistoryEntry({}, "a", entry("1", "SELECT 1"));
    history = addHistoryEntry(history, "a", entry("2", "SELECT 2"));
    expect(historyFor(removeHistoryEntry(history, "a", "1"), "a").map(e => e.id)).toEqual(["2"]);
    expect(historyFor(clearHistory(history, "a"), "a")).toEqual([]);
  });

  it("ignores malformed stored data", () => {
    expect(historyFor(null, "a")).toEqual([]);
    expect(historyFor([], "a")).toEqual([]);
    expect(historyFor({ a: [{ id: 1 }, entry("ok", "SELECT 1")] }, "a").map(e => e.id)).toEqual(["ok"]);
    expect(historyFor(addHistoryEntry("garbage", "a", entry("1", "SELECT 1")), "a")).toHaveLength(1);
  });
});
