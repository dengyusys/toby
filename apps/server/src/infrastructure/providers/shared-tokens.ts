/**
 * Shared runtime values with no class to reference — the resolved config
 * and the clock. Provided globally by SharedProvidersModule.forRoot in the
 * composition root, injected everywhere by token. Tests replace them the
 * standard way, with `overrideProvider(TOKEN).useValue(...)`.
 */

export const TOBY_CONFIG = Symbol("TOBY_CONFIG");
export const CLOCK = Symbol("CLOCK");

/** Millis-since-epoch clock; a token so tests pin and advance time. */
export type Clock = () => number;
