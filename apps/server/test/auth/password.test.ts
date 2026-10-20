/**
 * Password hashing: round trip, wrong passwords, and malformed stored
 * values all behave — verification never throws, it just says false.
 */

import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
} from "../../src/domains/auth/password.ts";

describe("password hashing", () => {
  it("round-trips a password and stays false for wrong ones", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored).toMatch(
      /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/,
    );
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("salts every hash: two runs never collide", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("malformed stored hashes verify as false, never throw", () => {
    for (const bad of [
      "",
      "plaintext",
      "scrypt$16384$8$1",
      "scrypt$N$r$p$salt$hash",
      "scrypt$16384$8$1$!!$%%",
      "md5$abc$def",
    ]) {
      expect(verifyPassword("whatever", bad)).toBe(false);
    }
  });
});
