/**
 * Access token secrets: 256-bit randoms, base64url, like session tokens.
 * Only a SHA-256 digest and the last four characters (for the list view) are
 * ever stored; the secret itself is returned exactly once, at creation.
 */

import { randomBytes } from "node:crypto";
import { digestOf } from "./digest.ts";

export function generateTokenSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** What a new token leaves in the database: the digest to look up, the visible tail. */
export function tokenFingerprint(secret: string): {
  digest: string;
  lastFour: string;
} {
  return { digest: digestOf(secret), lastFour: secret.slice(-4) };
}
