/**
 * System domain injection tokens. Kept in their own file so controllers
 * and the module never import each other (circular imports make decorator
 * tokens undefined under esbuild/vitest).
 */

export const SYSTEM_SERVICE = Symbol("SYSTEM_SERVICE");
