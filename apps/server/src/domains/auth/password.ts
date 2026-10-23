/**
 * Password verification: scrypt with a stored random salt, constant-time
 * comparison, no plaintext ever retained. The stored format is
 * `scrypt$N$r$p$saltB64$hashB64`; scripts/hash-password.js generates it —
 * keep the two in sync when the format changes.
 *
 * Parameter upgrade path (N/r/p): current N=16384 sits below the OWASP
 * suggestion of 2^17. Raising it means: generate fresh hashes with
 * scripts/hash-password.js, let SCRYPT_* and the config hash regex accept
 * both old and new during one migration window, and re-hash on the next
 * successful login — not a breaking change.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64");
    expected = Buffer.from(parts[5]!, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  // Even a shape-valid hash can carry parameters the runtime rejects;
  // verification answers false, it never turns into a 500.
  let computed: Buffer;
  try {
    computed = scryptSync(password, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  return timingSafeEqual(computed, expected);
}
