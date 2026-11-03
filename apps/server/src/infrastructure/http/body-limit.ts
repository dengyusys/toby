/**
 * The request body limit: 16 KiB, tight by design — every write goes through
 * small JSON proposals, never bulk payloads.
 */

export const REQUEST_BODY_LIMIT_BYTES = 16 * 1024;
