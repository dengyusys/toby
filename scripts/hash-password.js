/**
 * Password hash generator for TOBY_AUTH_PASSWORD_HASH: prints an
 * scrypt$N$r$p$salt$hash value for the password read from argv[2] or
 * stdin. The format is verified by apps/server/src/domains/auth/password.ts
 * — keep the two in sync when the format changes. The password itself never
 * leaves this process.
 */

import { randomBytes, scryptSync } from "node:crypto";
import readline from "node:readline";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

function hash(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function readPassword() {
  if (process.argv[2] !== undefined) {
    return process.argv[2];
  }
  const rl = readline.createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) {
    lines.push(line);
  }
  return lines.join("\n");
}

const password = await readPassword();
if (password.length === 0) {
  console.error("usage: node scripts/hash-password.js <password>");
  console.error("       echo <password> | node scripts/hash-password.js");
  process.exitCode = 1;
} else {
  console.log(hash(password));
}
