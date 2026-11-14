/**
 * One error type crosses the AI port: transport and parse failures map to
 * an AiError with a closed code union; the raw error stays as `cause`.
 * Domains translate these into their own HTTP-shaped errors.
 *
 * "unparseable-output" carries two path-specific meanings: on the
 * single-shot client the reply was not parseable JSON after its one retry;
 * on the agent path the run finished without any settling tool call.
 */

export type AiErrorCode =
  | "unconfigured"
  | "request-failed"
  | "timeout"
  | "unparseable-output"
  | "max-turns-exceeded";

/**
 * The one "no model anywhere" message every AI path shares: the settings
 * page is the primary fix, the environment variable stays the documented
 * fallback. Domains answer the wire with their own copy of the same words.
 */
export const AI_UNCONFIGURED_MESSAGE =
  'AI is not configured: pick a model on the settings page, or set TOBY_AI_MODEL to a "provider/model" pair (e.g. "zai/glm-4.7")';

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "AiError";
    this.code = code;
  }
}
