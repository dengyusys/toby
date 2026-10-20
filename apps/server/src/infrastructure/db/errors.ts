/**
 * One error type crosses the port: adapters map driver-specific errors to a
 * DbError with a closed code union and keep the raw error as `cause`. Raw
 * driver errors never leave an adapter.
 */

export type DbErrorCode =
  | "unique-violation"
  | "foreign-key-violation"
  | "constraint"
  | "syntax"
  | "busy"
  | "connection"
  | "unknown";

export class DbError extends Error {
  readonly code: DbErrorCode;

  constructor(code: DbErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "DbError";
    this.code = code;
  }
}
