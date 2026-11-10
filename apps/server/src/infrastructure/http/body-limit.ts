/**
 * The request body limit: 16 KiB, tight by design — every write is a
 * small JSON document, never a bulk payload.
 */

export const REQUEST_BODY_LIMIT_BYTES = 16 * 1024;
