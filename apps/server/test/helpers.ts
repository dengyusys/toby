/**
 * Shared test helpers. Kept dependency-free: everything here must be
 * usable from any suite without pulling in app code.
 */

import type { AiError } from "../src/infrastructure/ai/errors.ts";

/** Await a promise that should reject with an AiError; returns the error. */
export async function caught(promise: Promise<unknown>): Promise<AiError> {
  return (await promise.catch((thrown: unknown) => thrown)) as AiError;
}
