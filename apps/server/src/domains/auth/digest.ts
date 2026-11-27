/**
 * SHA-256 hex digest of a secret — the only form of a session token or an
 * access token the server ever keeps.
 */

import { createHash } from "node:crypto";

export function digestOf(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
