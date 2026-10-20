/**
 * One error type crosses the AI port: transport and parse failures map to
 * an AiError with a closed code union; the raw error stays as `cause`.
 * Domains translate these into their own HTTP-shaped errors.
 */

export type AiErrorCode =
  "unconfigured" | "request-failed" | "timeout" | "unparseable-output";

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "AiError";
    this.code = code;
  }
}
