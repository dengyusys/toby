/**
 * Shared runtime values with no class to reference — the resolved config
 * and the injectable clock. Provided globally by
 * SharedProvidersModule.forRoot in the composition root (and per-app by the
 * test fixture), injected everywhere by token.
 */

export const TOBY_CONFIG = Symbol("TOBY_CONFIG");
export const CLOCK = Symbol("CLOCK");

/** Millis-since-epoch clock; a token so tests pin and advance time. */
export type Clock = () => number;

export interface SharedProviderOptions {
  clock?: Clock;
}
