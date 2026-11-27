/**
 * Token secrets: high-entropy, never repeating, and leaving only a digest
 * and a visible tail behind.
 */

import { describe, expect, it } from "vitest";
import { digestOf } from "../../src/domains/auth/digest.ts";
import {
  generateTokenSecret,
  tokenFingerprint,
} from "../../src/domains/auth/tokens.ts";

describe("access token secrets", () => {
  it("are 43-character base64url strings that never repeat", () => {
    const secrets = new Set(Array.from({ length: 50 }, generateTokenSecret));
    expect(secrets.size).toBe(50);
    for (const secret of secrets) {
      // 32 bytes as base64url without padding.
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("the fingerprint holds a sha256 digest and the last four characters, nothing else", () => {
    const secret = generateTokenSecret();
    const fingerprint = tokenFingerprint(secret);
    expect(fingerprint.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint.digest).toBe(digestOf(secret));
    expect(fingerprint.lastFour).toBe(secret.slice(-4));
    expect(secret).not.toContain(fingerprint.digest);
  });
});
