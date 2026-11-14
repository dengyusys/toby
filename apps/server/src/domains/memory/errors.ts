/**
 * The memory domain's closed wire-code union: clients match these, never
 * messages. Parse failures of the storage file are deliberately a 500 —
 * MEMORY.md is user-editable state, and a file that no longer parses is
 * refused, never repaired (docs/decisions/personal-agent-memory.md).
 */

import { DomainHttpError } from "../../infrastructure/http/http-error.ts";

export type MemoryErrorCode =
  | "INVALID_ENTRY"
  | "ENTRY_NOT_FOUND"
  | "AMBIGUOUS_ENTRY"
  | "DUPLICATE_ENTRY"
  | "MEMORY_FILE_INVALID"
  | "LIMIT_REACHED";

/** Use-case failure (missing entry, ambiguity, duplicates, full memory). */
export class MemoryRequestError extends DomainHttpError {
  constructor(code: MemoryErrorCode, status: number, message: string) {
    super(status, code, message);
    this.name = "MemoryRequestError";
  }
}

/** Entry-shape/semantics rejection from the trust boundary (parser.ts). */
export class MemoryInputError extends DomainHttpError {
  constructor(message: string) {
    super(400, "INVALID_ENTRY", message);
    this.name = "MemoryInputError";
  }
}

/** The storage file no longer parses: refused, never repaired (500). */
export class MemoryFileInvalidError extends DomainHttpError {
  constructor(message: string) {
    super(500, "MEMORY_FILE_INVALID", message);
    this.name = "MemoryFileInvalidError";
  }
}
