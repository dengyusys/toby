/**
 * Shared test helpers. Kept dependency-free: type-only imports from app
 * code, zero runtime pull-in, usable from any suite.
 */

import type { AiError } from "../src/infrastructure/ai/errors.ts";

/**
 * Await a promise that should reject; returns the rejection. Assumes the
 * rejected value is an AiError — otherwise later error.code assertions
 * fail in confusing ways, so only use it where that holds.
 */
export async function caughtAiError(
  promise: Promise<unknown>,
): Promise<AiError> {
  return (await promise.catch((thrown: unknown) => thrown)) as AiError;
}
