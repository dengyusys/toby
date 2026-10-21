/**
 * Password hash generator for TOBY_AUTH_PASSWORD_HASH: prints an
 * scrypt$N$r$p$salt$hash value for the password read from argv[2] or
 * stdin. Hashing lives in the auth domain — importing it directly keeps
 * the format single-sourced. The password itself never leaves this process.
 */

import readline from "node:readline";
import { hashPassword } from "../apps/server/src/domains/auth/password.ts";

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
  console.log(hashPassword(password));
}
