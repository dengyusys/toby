/**
 * The settings domain's closed wire-code union: clients match these, never
 * messages. Every settings failure is a request-shape or value problem,
 * so each code answers 400.
 */

import { DomainHttpError } from "../../infrastructure/http/http-error.ts";

export type SettingsErrorCode =
  | "SETTINGS_INVALID_MODEL"
  | "SETTINGS_UNKNOWN_PROVIDER"
  | "SETTINGS_INVALID_CREDENTIAL"
  | "SETTINGS_BODY_INVALID";

/**
 * Use-case failure: bad model spec, unknown provider, or an unusable
 * credential change.
 */
export class SettingsRequestError extends DomainHttpError {
  constructor(code: SettingsErrorCode, message: string) {
    super(400, code, message);
    this.name = "SettingsRequestError";
  }
}
