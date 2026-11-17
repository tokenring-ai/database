/**
 * A statement judged read-only (see isReadOnlyQuery) tried to write when the database ran it in
 * read-only mode: a function with side effects (`nextval`, `dblink_exec`, ...) or anything else the
 * text check could not see. Callers treat the statement as a write from then on.
 */
export class ReadOnlyViolationError extends Error {
  constructor(cause: unknown) {
    super(`This statement tried to modify data, so it is not a read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "ReadOnlyViolationError";
  }
}

/** Whether a driver error is the database refusing a write in read-only mode. */
export function isReadOnlyViolation(error: unknown): boolean {
  const record = error as { code?: unknown; errno?: unknown; message?: unknown } | null;
  if (!record || typeof record !== "object") return false;
  // Postgres SQLSTATE 25006 read_only_sql_transaction; MySQL ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION.
  if (record.code === "25006" || record.errno === 1792 || record.code === "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return /read-only transaction|READ ONLY transaction|attempt to write a readonly database/i.test(message);
}
