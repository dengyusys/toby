/**
 * Shared AI value validation: the "provider/model" spec pattern, the
 * timeout bounds and their default. Environment resolution (config.ts)
 * and the settings domain (runtime writes) validate against this one
 * definition, so the two paths can never drift.
 */

/** pi-ai's "provider/model" pair (e.g. "zai/glm-4.7"). */
export const AI_MODEL_PATTERN = /^([a-z0-9][a-z0-9_-]*)\/(\S+)$/;

/** Inclusive bounds for the AI request timeout, in milliseconds. */
export const AI_TIMEOUT_BOUNDS = { min: 1_000, max: 120_000 };

/** The timeout in force when neither the database nor the environment says one. */
export const DEFAULT_AI_TIMEOUT_MS = 30_000;

/**
 * Trim and validate one "provider/model" spec; returns the trimmed value.
 * Throws a plain Error with the exact message environment resolution has
 * always answered — callers translate as they see fit.
 */
export function validateModelSpec(raw: string): string {
  const model = raw.trim();
  if (!AI_MODEL_PATTERN.test(model)) {
    throw new Error(
      'TOBY_AI_MODEL must be a "provider/model" pair (e.g. "zai/glm-4.7")',
    );
  }
  return model;
}
